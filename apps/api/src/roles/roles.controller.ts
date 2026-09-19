import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { createRoleSchema, updateRoleSchema, type CreateRoleInput } from "@jana/shared";
import { CurrentUser, Ctx, RequirePermissions, type AuthUser, type ReqCtx } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { RolesService } from "./roles.service";

@Controller()
export class RolesController {
  constructor(private roles: RolesService) {}

  @Get("permissions")
  @RequirePermissions("role:view")
  catalog() {
    return this.roles.catalog();
  }

  @Get("roles")
  @RequirePermissions("role:view")
  list() {
    return this.roles.list();
  }

  @Post("roles")
  @RequirePermissions("role:manage")
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodPipe(createRoleSchema)) dto: CreateRoleInput,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.roles.create(actor, dto, ctx);
  }

  @Patch("roles/:id")
  @RequirePermissions("role:manage")
  update(
    @CurrentUser() actor: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateRoleSchema)) dto: Partial<CreateRoleInput>,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.roles.update(actor, id, dto, ctx);
  }

  @Delete("roles/:id")
  @HttpCode(204)
  @RequirePermissions("role:manage")
  async remove(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: ReqCtx) {
    await this.roles.remove(id, ctx);
  }
}
