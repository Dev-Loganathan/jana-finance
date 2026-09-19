import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import {
  createUserSchema,
  listQuerySchema,
  updateUserSchema,
  type CreateUserInput,
  type ListQuery,
  type UpdateUserInput,
} from "@jana/shared";
import { CurrentUser, Ctx, RequirePermissions, type AuthUser, type ReqCtx } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { UsersService } from "./users.service";

@Controller("users")
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  @RequirePermissions("user:view")
  list(@Query(new ZodPipe(listQuerySchema)) q: ListQuery) {
    return this.users.list(q);
  }

  @Get(":id")
  @RequirePermissions("user:view")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Post()
  @RequirePermissions("user:manage")
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodPipe(createUserSchema)) dto: CreateUserInput,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.users.create(actor, dto, ctx);
  }

  @Patch(":id")
  @RequirePermissions("user:manage")
  update(
    @CurrentUser() actor: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateUserSchema)) dto: UpdateUserInput,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.users.update(actor, id, dto, ctx);
  }

  @Post(":id/suspend")
  @HttpCode(200)
  @RequirePermissions("user:manage")
  suspend(@CurrentUser() actor: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: ReqCtx) {
    return this.users.setStatus(actor, id, "SUSPENDED", ctx);
  }

  @Post(":id/activate")
  @HttpCode(200)
  @RequirePermissions("user:manage")
  activate(@CurrentUser() actor: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: ReqCtx) {
    return this.users.setStatus(actor, id, "ACTIVE", ctx);
  }

  @Post(":id/reset-password")
  @HttpCode(204)
  @RequirePermissions("user:manage")
  async resetPassword(@CurrentUser() actor: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: ReqCtx) {
    await this.users.resetPassword(actor, id, ctx);
  }

  @Post(":id/revoke-sessions")
  @HttpCode(200)
  @RequirePermissions("user:manage")
  revokeSessions(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: ReqCtx) {
    return this.users.revokeSessions(id, ctx);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("user:manage")
  async remove(@CurrentUser() actor: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: ReqCtx) {
    await this.users.remove(actor, id, ctx);
  }
}
