import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { Prisma, Role, User } from "@prisma/client";
import type { CreateUserInput, ListQuery, UpdateUserInput } from "@jana/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { MailService } from "../mail/mail.service";
import { env } from "../config/env";
import type { AuthUser, ReqCtx } from "../common/decorators";

type UserWithRole = User & { role: Role };

const SORTABLE = new Set(["firstName", "email", "status", "lastLoginAt", "createdAt"]);

export function toUserDto(u: UserWithRole) {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    name: `${u.firstName} ${u.lastName}`.trim(),
    email: u.email,
    phone: u.phone,
    employeeCode: u.employeeCode,
    status: u.status,
    role: { id: u.roleId, name: u.role.name, locked: u.role.locked },
    totpEnabled: u.totpEnabled,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private auth: AuthService,
    private mail: MailService,
  ) {}

  async list(q: ListQuery) {
    const where: Prisma.UserWhereInput = { deletedAt: null };
    if (q.q) {
      where.OR = ["firstName", "lastName", "email", "phone", "employeeCode"].map((f) => ({
        [f]: { contains: q.q, mode: "insensitive" },
      }));
    }
    const [field, dir] = q.sort?.split(":") ?? ["createdAt", "desc"];
    const orderBy = { [SORTABLE.has(field!) ? field! : "createdAt"]: dir === "asc" ? "asc" : "desc" };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { role: true },
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: rows.map(toUserDto), page: q.page, pageSize: q.pageSize, total };
  }

  private async getOrThrow(id: string) {
    const u = await this.prisma.user.findFirst({ where: { id, deletedAt: null }, include: { role: true } });
    if (!u) throw new NotFoundException({ code: "NOT_FOUND", message: "User not found" });
    return u;
  }

  async get(id: string) {
    return toUserDto(await this.getOrThrow(id));
  }

  /** The Super Admin role can never be assigned through the UI, and nobody can hand out permissions they lack. */
  private async assertAssignable(actor: AuthUser, roleId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new BadRequestException({ code: "ROLE_NOT_FOUND", message: "Role not found" });
    if (role.locked)
      throw new ForbiddenException({ code: "PROTECTED", message: "The Super Admin role cannot be assigned" });
    const missing = role.permissions.filter((p) => !actor.permissions.includes(p as never));
    if (missing.length)
      throw new ForbiddenException({
        code: "ESCALATION",
        message: "You cannot assign a role with permissions you do not hold",
      });
    return role;
  }

  private assertNotProtected(target: UserWithRole) {
    if (target.role.locked)
      throw new ForbiddenException({ code: "PROTECTED", message: "The Super Admin account is protected" });
  }

  async create(actor: AuthUser, dto: CreateUserInput, ctx: ReqCtx) {
    await this.assertAssignable(actor, dto.roleId);
    if (await this.prisma.user.findUnique({ where: { email: dto.email } })) {
      throw new ConflictException({ code: "EMAIL_TAKEN", message: "A user with this email already exists" });
    }
    const invite = dto.mode === "invite";
    const passwordHash = await this.auth.hashPassword(invite ? randomBytes(32).toString("base64url") : dto.password!);
    const { user, token } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phone: dto.phone,
          employeeCode: dto.employeeCode,
          roleId: dto.roleId,
          passwordHash,
          status: invite ? "INVITED" : "ACTIVE",
          mustChangePassword: true,
        },
        include: { role: true },
      });
      const token = invite ? await this.auth.createPasswordToken(user.id, "INVITE", tx) : undefined;
      await this.audit.record(
        ctx,
        { action: "user.create", entity: "User", entityId: user.id, after: toUserDto(user) },
        tx,
      );
      return { user, token };
    });
    if (token)
      await this.mail.send(
        user.email,
        "You are invited to Jana Finance",
        `Set your password: ${env().WEB_ORIGIN}/accept-invite?token=${token}`,
      );
    return toUserDto(user);
  }

  async update(actor: AuthUser, id: string, dto: UpdateUserInput, ctx: ReqCtx) {
    const before = await this.getOrThrow(id);
    this.assertNotProtected(before);
    if (dto.roleId && dto.roleId !== before.roleId) await this.assertAssignable(actor, dto.roleId);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.user.update({ where: { id }, data: dto, include: { role: true } });
      await this.audit.record(
        ctx,
        { action: "user.update", entity: "User", entityId: id, before: toUserDto(before), after: toUserDto(after) },
        tx,
      );
      return toUserDto(after);
    });
  }

  async setStatus(actor: AuthUser, id: string, status: "ACTIVE" | "SUSPENDED", ctx: ReqCtx) {
    const before = await this.getOrThrow(id);
    this.assertNotProtected(before);
    if (id === actor.id)
      throw new ForbiddenException({ code: "SELF_ACTION", message: "You cannot change your own status" });
    if (before.status === "INVITED")
      throw new BadRequestException({ code: "NOT_ACCEPTED", message: "User has not accepted the invite yet" });
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.user.update({
        where: { id },
        data: { status, failedLogins: 0, lockedUntil: null },
        include: { role: true },
      });
      if (status === "SUSPENDED")
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: "suspended" },
        });
      await this.audit.record(
        ctx,
        {
          action: status === "SUSPENDED" ? "user.suspend" : "user.activate",
          entity: "User",
          entityId: id,
          before: { status: before.status },
          after: { status },
        },
        tx,
      );
      return toUserDto(after);
    });
  }

  async resetPassword(actor: AuthUser, id: string, ctx: ReqCtx) {
    const target = await this.getOrThrow(id);
    this.assertNotProtected(target);
    const token = await this.prisma.$transaction(async (tx) => {
      const t = await this.auth.createPasswordToken(id, "RESET", tx);
      await this.audit.record(ctx, { action: "user.password_reset_requested", entity: "User", entityId: id }, tx);
      return t;
    });
    await this.mail.send(
      target.email,
      "Reset your Jana Finance password",
      `Reset link: ${env().WEB_ORIGIN}/accept-invite?token=${token}`,
    );
  }

  async revokeSessions(id: string, ctx: ReqCtx) {
    const target = await this.getOrThrow(id);
    const r = await this.prisma.session.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "forced_logout" },
    });
    await this.audit.record(ctx, {
      action: "user.sessions_revoked",
      entity: "User",
      entityId: target.id,
      after: { count: r.count },
    });
    return { revoked: r.count };
  }

  async remove(actor: AuthUser, id: string, ctx: ReqCtx) {
    const before = await this.getOrThrow(id);
    this.assertNotProtected(before);
    if (id === actor.id) throw new ForbiddenException({ code: "SELF_ACTION", message: "You cannot delete yourself" });
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { deletedAt: new Date(), status: "SUSPENDED" } });
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: "deleted" },
      });
      await this.audit.record(
        ctx,
        { action: "user.delete", entity: "User", entityId: id, before: toUserDto(before) },
        tx,
      );
    });
  }
}
