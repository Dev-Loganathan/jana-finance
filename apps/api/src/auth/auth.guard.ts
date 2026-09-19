import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Permission } from "@jana/shared";
import { isPermission } from "@jana/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ALLOW_INCOMPLETE_KEY, AppRequest, PERMS_KEY, PUBLIC_KEY } from "../common/decorators";

/**
 * Global guard: authentication, "setup pending" gate, then permission check.
 * User and role are loaded from the DB on every request, so suspensions, role edits
 * and session revocations take effect immediately (fine at this scale).
 * Endpoints are auth-required by default; use @Public() to opt out.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwt: JwtService,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer "))
      throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "Sign in required" });

    let payload: { sub: string; sid: string };
    try {
      payload = await this.jwt.verifyAsync(header.slice(7));
    } catch {
      throw new UnauthorizedException({ code: "TOKEN_INVALID", message: "Session expired" });
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      include: { user: { include: { role: true } } },
    });
    const user = session?.user;
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt < new Date() ||
      !user ||
      user.deletedAt ||
      user.status !== "ACTIVE" ||
      user.id !== payload.sub
    ) {
      throw new UnauthorizedException({ code: "TOKEN_INVALID", message: "Session expired" });
    }

    const setupPending = user.mustChangePassword || (user.role.locked && !user.totpEnabled);
    req.user = {
      id: user.id,
      email: user.email,
      name: `${user.firstName} ${user.lastName}`.trim(),
      roleId: user.roleId,
      roleName: user.role.name,
      roleLocked: user.role.locked,
      permissions: user.role.permissions.filter(isPermission) as Permission[],
      sessionId: session.id,
      setupPending,
    };

    if (setupPending && !this.reflector.getAllAndOverride<boolean>(ALLOW_INCOMPLETE_KEY, targets)) {
      throw new ForbiddenException({ code: "SETUP_REQUIRED", message: "Change your password / set up 2FA first" });
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMS_KEY, targets) ?? [];
    if (!required.every((p) => req.user!.permissions.includes(p))) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "You do not have permission to do this" });
    }
    return true;
  }
}
