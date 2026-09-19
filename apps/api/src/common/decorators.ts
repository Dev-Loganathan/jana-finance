import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Permission } from "@jana/shared";
import type { Request } from "express";

export const PUBLIC_KEY = "isPublic";
export const PERMS_KEY = "permissions";
export const ALLOW_INCOMPLETE_KEY = "allowIncomplete";

/** No authentication required (login, refresh, invite accept, health). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Every listed permission is required. Endpoints with neither this nor @Public are auth-only. */
export const RequirePermissions = (...p: Permission[]) => SetMetadata(PERMS_KEY, p);
/** Allowed while the user still has to change password / set up 2FA. */
export const AllowIncomplete = () => SetMetadata(ALLOW_INCOMPLETE_KEY, true);

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roleId: string;
  roleName: string;
  roleLocked: boolean;
  permissions: Permission[];
  sessionId: string;
  /** True while password change or 2FA setup is still pending. */
  setupPending: boolean;
}

export interface ReqCtx {
  userId?: string;
  userEmail?: string;
  ip?: string;
  userAgent?: string;
}

export type AppRequest = Request & { user?: AuthUser };

export const CurrentUser = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest<AppRequest>().user!,
);

/** Audit/request context: who, from where. */
export const Ctx = createParamDecorator((_d: unknown, ctx: ExecutionContext): ReqCtx => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  return { userId: req.user?.id, userEmail: req.user?.email, ip: req.ip, userAgent: req.headers["user-agent"] };
});
