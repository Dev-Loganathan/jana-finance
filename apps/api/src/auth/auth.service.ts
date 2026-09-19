import { HttpException, Injectable, UnauthorizedException, BadRequestException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { authenticator } from "otplib";
import * as argon2 from "argon2";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Prisma, TokenPurpose, User, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CryptoService } from "../common/crypto.service";
import { env } from "../config/env";
import type { AuthUser, ReqCtx } from "../common/decorators";
import { isPermission } from "@jana/shared";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newToken = () => randomBytes(48).toString("base64url");
authenticator.options = { window: 1 };

// Verified against when the email is unknown, so timing does not reveal which emails exist.
const DUMMY_HASH = argon2.hash("not-a-real-password");

type UserWithRole = User & { role: Role };

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: AuditService,
    private crypto: CryptoService,
  ) {}

  hashPassword(p: string) {
    return argon2.hash(p, { type: argon2.argon2id });
  }

  publicUser(u: UserWithRole) {
    return {
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.trim(),
      email: u.email,
      phone: u.phone,
      role: { id: u.roleId, name: u.role.name },
      permissions: u.role.permissions.filter(isPermission),
      mustChangePassword: u.mustChangePassword,
      totpEnabled: u.totpEnabled,
      requiresTotpSetup: u.role.locked && !u.totpEnabled,
    };
  }

  async login(dto: { email: string; password: string; totp?: string }, ctx: ReqCtx) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
      include: { role: true },
    });
    const fail = async (reason: string, userId?: string) => {
      await this.audit.record(
        { ...ctx, userId, userEmail: dto.email },
        { action: "auth.login_failed", entity: "User", entityId: userId, after: { reason } },
      );
      throw new UnauthorizedException({ code: "INVALID_CREDENTIALS", message: "Invalid email or password" });
    };

    if (!user) {
      await argon2.verify(await DUMMY_HASH, dto.password).catch(() => false);
      return fail("unknown_email");
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit.record(
        { ...ctx, userId: user.id, userEmail: user.email },
        { action: "auth.login_blocked_locked", entity: "User", entityId: user.id },
      );
      throw new HttpException({ code: "ACCOUNT_LOCKED", message: "Too many attempts. Try again later." }, 423);
    }
    const passwordOk = await argon2.verify(user.passwordHash, dto.password).catch(() => false);
    if (!passwordOk || user.status !== "ACTIVE")
      return this.registerFailure(user, passwordOk ? "not_active" : "bad_password", fail);

    if (user.totpEnabled) {
      if (!dto.totp)
        throw new UnauthorizedException({ code: "TOTP_REQUIRED", message: "Enter your authenticator code" });
      if (!authenticator.check(dto.totp, this.crypto.decrypt(user.totpSecretEnc!)))
        return this.registerFailure(user, "bad_totp", fail);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const tokens = await this.createSession(user, ctx);
    await this.audit.record(
      { ...ctx, userId: user.id, userEmail: user.email },
      { action: "auth.login", entity: "User", entityId: user.id },
    );
    return { ...tokens, user: this.publicUser(user) };
  }

  private async registerFailure(user: User, reason: string, fail: (r: string, id?: string) => Promise<never>) {
    const attempts = user.failedLogins + 1;
    const lock = attempts >= env().LOGIN_MAX_ATTEMPTS;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: lock ? 0 : attempts,
        lockedUntil: lock ? new Date(Date.now() + env().LOGIN_LOCK_MINUTES * 60_000) : undefined,
      },
    });
    return fail(lock ? `${reason}_locked` : reason, user.id);
  }

  private signAccess(userId: string, sessionId: string) {
    return this.jwt.signAsync({ sub: userId, sid: sessionId });
  }

  private async createSession(
    user: User,
    ctx: ReqCtx,
    familyId?: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Tokens> {
    const refreshToken = newToken();
    const session = await tx.session.create({
      data: {
        userId: user.id,
        familyId: familyId ?? randomUUID(),
        tokenHash: sha256(refreshToken),
        ip: ctx.ip,
        userAgent: ctx.userAgent?.slice(0, 300),
        expiresAt: new Date(Date.now() + env().REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      },
    });
    return { accessToken: await this.signAccess(user.id, session.id), refreshToken };
  }

  async refresh(refreshToken: string | undefined, ctx: ReqCtx) {
    const bad = () => new UnauthorizedException({ code: "TOKEN_INVALID", message: "Session expired" });
    if (!refreshToken) throw bad();
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: { include: { role: true } } },
    });
    if (!session) throw bad();

    if (session.revokedAt) {
      // A rotated token was presented again: assume theft and kill the whole family.
      if (session.revokedReason === "rotated") {
        await this.prisma.session.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: "reuse_detected" },
        });
        await this.audit.record(
          { ...ctx, userId: session.userId, userEmail: session.user.email },
          { action: "auth.refresh_reuse_detected", entity: "Session", entityId: session.id },
        );
      }
      throw bad();
    }
    const u = session.user;
    if (session.expiresAt < new Date() || u.deletedAt || u.status !== "ACTIVE") throw bad();

    const tokens = await this.prisma.$transaction(async (tx) => {
      await tx.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokedReason: "rotated" } });
      return this.createSession(u, ctx, session.familyId, tx);
    });
    return { ...tokens, user: this.publicUser(u) };
  }

  async logout(refreshToken: string | undefined, ctx: ReqCtx) {
    if (!refreshToken) return;
    const s = await this.prisma.session.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (s && !s.revokedAt) {
      await this.prisma.session.update({
        where: { id: s.id },
        data: { revokedAt: new Date(), revokedReason: "logout" },
      });
      await this.audit.record(
        { ...ctx, userId: s.userId },
        { action: "auth.logout", entity: "Session", entityId: s.id },
      );
    }
  }

  async me(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { role: true } });
    return this.publicUser(u);
  }

  async changePassword(user: AuthUser, dto: { currentPassword: string; newPassword: string }, ctx: ReqCtx) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await argon2.verify(u.passwordHash, dto.currentPassword).catch(() => false))) {
      throw new BadRequestException({ code: "WRONG_PASSWORD", message: "Current password is incorrect" });
    }
    if (dto.currentPassword === dto.newPassword)
      throw new BadRequestException({ code: "SAME_PASSWORD", message: "Choose a different password" });
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: u.id },
        data: { passwordHash: await this.hashPassword(dto.newPassword), mustChangePassword: false },
      });
      await tx.session.updateMany({
        where: { userId: u.id, revokedAt: null, id: { not: user.sessionId } },
        data: { revokedAt: new Date(), revokedReason: "password_changed" },
      });
      await this.audit.record(ctx, { action: "auth.password_changed", entity: "User", entityId: u.id }, tx);
    });
  }

  async totpSetup(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (u.totpEnabled)
      throw new BadRequestException({ code: "TOTP_ALREADY_ENABLED", message: "2FA is already enabled" });
    // Idempotent until 2FA is enabled: two overlapping setup requests (a double click, or React running the effect
    // twice in development) must not replace the secret the first QR code was built from.
    const secret = u.totpSecretEnc ? this.crypto.decrypt(u.totpSecretEnc) : authenticator.generateSecret();
    if (!u.totpSecretEnc)
      await this.prisma.user.update({ where: { id: u.id }, data: { totpSecretEnc: this.crypto.encrypt(secret) } });
    return { secret, otpauthUrl: authenticator.keyuri(u.email, "Jana Finance", secret) };
  }

  async totpEnable(user: AuthUser, code: string, ctx: ReqCtx) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!u.totpSecretEnc || !authenticator.check(code, this.crypto.decrypt(u.totpSecretEnc))) {
      throw new BadRequestException({ code: "TOTP_INVALID", message: "Invalid code" });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: u.id }, data: { totpEnabled: true } });
      await this.audit.record(ctx, { action: "auth.2fa_enabled", entity: "User", entityId: u.id }, tx);
    });
  }

  listSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastUsedAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async revokeSession(userId: string, sessionId: string, ctx: ReqCtx) {
    const r = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "user_revoked" },
    });
    if (r.count)
      await this.audit.record(ctx, { action: "auth.session_revoked", entity: "Session", entityId: sessionId });
  }

  /** Create a single-use invite/reset token. The raw token is returned once and only its hash is stored. */
  async createPasswordToken(
    userId: string,
    purpose: TokenPurpose,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const token = newToken();
    await tx.passwordToken.create({
      data: {
        userId,
        purpose,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + (purpose === "INVITE" ? 72 : 2) * 3_600_000),
      },
    });
    return token;
  }

  async acceptToken(token: string, password: string, ctx: ReqCtx) {
    const t = await this.prisma.passwordToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!t || t.usedAt || t.expiresAt < new Date() || t.user.deletedAt || t.user.status === "SUSPENDED") {
      throw new BadRequestException({ code: "TOKEN_INVALID", message: "This link is invalid or has expired" });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordToken.update({ where: { id: t.id }, data: { usedAt: new Date() } });
      await tx.user.update({
        where: { id: t.userId },
        data: {
          passwordHash: await this.hashPassword(password),
          status: "ACTIVE",
          mustChangePassword: false,
          failedLogins: 0,
          lockedUntil: null,
        },
      });
      await tx.session.updateMany({
        where: { userId: t.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: "password_reset" },
      });
      await this.audit.record(
        { ...ctx, userId: t.userId, userEmail: t.user.email },
        {
          action: t.purpose === "INVITE" ? "auth.invite_accepted" : "auth.password_reset",
          entity: "User",
          entityId: t.userId,
        },
        tx,
      );
    });
  }
}
