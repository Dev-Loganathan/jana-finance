import { Controller, Get, Query } from "@nestjs/common";
import { listQuerySchema, type ListQuery } from "@jana/shared";
import { RequirePermissions } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { PrismaService } from "../prisma/prisma.service";

@Controller("audit")
export class AuditController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @RequirePermissions("audit:view")
  async list(@Query(new ZodPipe(listQuerySchema)) q: ListQuery) {
    const where = q.q
      ? {
          OR: [
            { action: { contains: q.q, mode: "insensitive" as const } },
            { userEmail: { contains: q.q, mode: "insensitive" as const } },
            { entity: { contains: q.q, mode: "insensitive" as const } },
          ],
        }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items: rows.map((r) => ({ ...r, id: r.id.toString() })), page: q.page, pageSize: q.pageSize, total };
  }
}
