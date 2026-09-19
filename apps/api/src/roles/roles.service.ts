import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PERMISSION_GROUPS, type CreateRoleInput } from "@jana/shared";
import type { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser, ReqCtx } from "../common/decorators";

const dto = (r: Role, userCount?: number) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  system: r.system,
  locked: r.locked,
  dataScope: r.dataScope,
  permissions: r.permissions,
  ...(userCount !== undefined && { userCount }),
});

@Injectable()
export class RolesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  catalog() {
    return PERMISSION_GROUPS;
  }

  async list() {
    const roles = await this.prisma.role.findMany({
      orderBy: [{ locked: "desc" }, { system: "desc" }, { name: "asc" }],
      include: { _count: { select: { users: { where: { deletedAt: null } } } } },
    });
    return roles.map((r) => dto(r, r._count.users));
  }

  private async getOrThrow(id: string) {
    const r = await this.prisma.role.findUnique({ where: { id } });
    if (!r) throw new NotFoundException({ code: "NOT_FOUND", message: "Role not found" });
    return r;
  }

  /** Nobody can grant a permission they do not hold themselves. */
  private assertCanGrant(actor: AuthUser, perms: string[] | undefined) {
    if (perms?.some((p) => !actor.permissions.includes(p as never))) {
      throw new ForbiddenException({ code: "ESCALATION", message: "You cannot grant permissions you do not hold" });
    }
  }

  async create(actor: AuthUser, input: CreateRoleInput, ctx: ReqCtx) {
    this.assertCanGrant(actor, input.permissions);
    if (await this.prisma.role.findUnique({ where: { name: input.name } }))
      throw new ConflictException({ code: "NAME_TAKEN", message: "A role with this name exists" });
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.role.create({ data: { ...input, permissions: [...new Set(input.permissions)] } });
      await this.audit.record(ctx, { action: "role.create", entity: "Role", entityId: r.id, after: dto(r) }, tx);
      return dto(r, 0);
    });
  }

  async update(actor: AuthUser, id: string, input: Partial<CreateRoleInput>, ctx: ReqCtx) {
    const before = await this.getOrThrow(id);
    if (before.locked)
      throw new ForbiddenException({ code: "PROTECTED", message: "The Super Admin role cannot be modified" });
    this.assertCanGrant(actor, input.permissions);
    if (
      input.name &&
      input.name !== before.name &&
      (await this.prisma.role.findUnique({ where: { name: input.name } }))
    ) {
      throw new ConflictException({ code: "NAME_TAKEN", message: "A role with this name exists" });
    }
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.role.update({
        where: { id },
        data: { ...input, permissions: input.permissions ? [...new Set(input.permissions)] : undefined },
      });
      await this.audit.record(
        ctx,
        { action: "role.update", entity: "Role", entityId: id, before: dto(before), after: dto(r) },
        tx,
      );
      return dto(r);
    });
  }

  async remove(id: string, ctx: ReqCtx) {
    const before = await this.getOrThrow(id);
    if (before.locked || before.system)
      throw new ForbiddenException({ code: "PROTECTED", message: "System roles cannot be deleted" });
    const users = await this.prisma.user.count({ where: { roleId: id, deletedAt: null } });
    if (users) throw new BadRequestException({ code: "ROLE_IN_USE", message: `${users} user(s) still have this role` });
    await this.prisma.$transaction(async (tx) => {
      await tx.role.delete({ where: { id } });
      await this.audit.record(ctx, { action: "role.delete", entity: "Role", entityId: id, before: dto(before) }, tx);
    });
  }
}
