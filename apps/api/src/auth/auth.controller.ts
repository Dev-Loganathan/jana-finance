import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { acceptInviteSchema, changePasswordSchema, loginSchema, totpCodeSchema } from "@jana/shared";
import { AllowIncomplete, CurrentUser, Ctx, Public, type AuthUser, type ReqCtx } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { env } from "../config/env";
import { AuthService } from "./auth.service";

const COOKIE = "jana_rt";
/** The API is served under /api, so the refresh cookie is only ever sent to the auth endpoints. */
const COOKIE_PATH = "/api/auth";

function setRefreshCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: env().NODE_ENV === "production",
    path: COOKIE_PATH,
    maxAge: env().REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
}

@Controller("auth")
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("login")
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) dto: { email: string; password: string; totp?: string },
    @Ctx() ctx: ReqCtx,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...rest } = await this.auth.login(dto, ctx);
    setRefreshCookie(res, refreshToken);
    return rest;
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() req: Request, @Ctx() ctx: ReqCtx, @Res({ passthrough: true }) res: Response) {
    const { refreshToken, ...rest } = await this.auth.refresh(req.cookies?.[COOKIE], ctx);
    setRefreshCookie(res, refreshToken);
    return rest;
  }

  @Public()
  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: Request, @Ctx() ctx: ReqCtx, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[COOKIE], ctx);
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("accept-token")
  @HttpCode(204)
  async acceptToken(
    @Body(new ZodPipe(acceptInviteSchema)) dto: { token: string; password: string },
    @Ctx() ctx: ReqCtx,
  ) {
    await this.auth.acceptToken(dto.token, dto.password, ctx);
  }

  @AllowIncomplete()
  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @AllowIncomplete()
  @Post("change-password")
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(changePasswordSchema)) dto: { currentPassword: string; newPassword: string },
    @Ctx() ctx: ReqCtx,
  ) {
    await this.auth.changePassword(user, dto, ctx);
  }

  @AllowIncomplete()
  @Post("2fa/setup")
  totpSetup(@CurrentUser() user: AuthUser) {
    return this.auth.totpSetup(user);
  }

  @AllowIncomplete()
  @Post("2fa/enable")
  @HttpCode(204)
  async totpEnable(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(totpCodeSchema)) dto: { code: string },
    @Ctx() ctx: ReqCtx,
  ) {
    await this.auth.totpEnable(user, dto.code, ctx);
  }

  @Get("sessions")
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user.id);
  }

  @Delete("sessions/:id")
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: ReqCtx) {
    await this.auth.revokeSession(user.id, id, ctx);
  }
}
