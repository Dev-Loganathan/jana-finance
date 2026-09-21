import type { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";

export interface ResetResult {
  applied: boolean;
  email: string;
}

/**
 * Break-glass recovery for the Super Admin account: resets the password, clears any lockout, removes 2FA (it must be set
 * up again), signs out every session and forces a password change at the next sign-in. Written to the audit log.
 *
 * With a `token` the reset is applied ONCE per token: a host that restarts the app (the free plan sleeps and wakes
 * it) can leave the switch on without undoing the owner's new password each time. To reset again, use a new token.
 * Without a token it always applies (the command-line script).
 */
export async function resetSuperAdmin(
  prisma: PrismaClient,
  opts: { password: string; token?: string },
): Promise<ResetResult> {
  const role = await prisma.role.findFirst({ where: { locked: true } });
  const user =
    role &&
    (await prisma.user.findFirst({ where: { roleId: role.id, deletedAt: null }, orderBy: { createdAt: "asc" } }));
  if (!user) throw new Error("No Super Admin account found. Run the seed first.");

  if (opts.token) {
    const done = await prisma.auditLog.findFirst({
      where: { action: "auth.break_glass_reset", entityId: user.id, after: { path: ["token"], equals: opts.token } },
      select: { id: true },
    });
    if (done) return { applied: false, email: user.email };
  }

  const passwordHash = await argon2.hash(opts.password, { type: argon2.argon2id });
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        mustChangePassword: true,
        failedLogins: 0,
        lockedUntil: null,
        totpEnabled: false,
        totpSecretEnc: null,
        status: "ACTIVE",
      },
    });
    await tx.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "break_glass_reset" },
    });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        userEmail: user.email,
        action: "auth.break_glass_reset",
        entity: "User",
        entityId: user.id,
        after: opts.token ? { token: opts.token } : undefined,
        userAgent: "cli",
      },
    });
  });
  return { applied: true, email: user.email };
}
