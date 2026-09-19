import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { ReqCtx } from "../common/decorators";

export interface AuditEntry {
  action: string; // e.g. "user.create", "auth.login"
  entity: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

const SENSITIVE = new Set([
  "passwordHash",
  "totpSecretEnc",
  "tokenHash",
  "password",
  "newPassword",
  "currentPassword",
  "token",
]);

/** Strip secrets so they can never reach the audit log. */
export function redact(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (k, v) => (SENSITIVE.has(k) ? "[redacted]" : typeof v === "bigint" ? v.toString() : v)),
  );
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /** Pass `tx` to write inside the caller's transaction so audit and change commit together. */
  async record(ctx: ReqCtx, e: AuditEntry, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    await tx.auditLog.create({
      data: {
        userId: ctx.userId,
        userEmail: ctx.userEmail,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId,
        before: redact(e.before),
        after: redact(e.after),
        ip: ctx.ip,
        userAgent: ctx.userAgent?.slice(0, 300),
      },
    });
  }
}
