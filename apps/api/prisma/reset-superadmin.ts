import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { env } from "../src/config/env";

/**
 * Break-glass recovery for the Super Admin account. Run only from a shell on the server:
 *   pnpm --filter @jana/api superadmin:reset
 * Resets the password to SEED_SUPERADMIN_PASSWORD, clears any lockout, removes 2FA (it must be set up again),
 * signs out every session and forces a password change on next login. The action is written to the audit log.
 */
env(); // load .env before Prisma reads DATABASE_URL
const prisma = new PrismaClient();

async function main() {
  const role = await prisma.role.findFirst({ where: { locked: true } });
  const user = role && (await prisma.user.findFirst({ where: { roleId: role.id, deletedAt: null } }));
  if (!user) throw new Error("No Super Admin account found. Run the seed first.");

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await argon2.hash(env().SEED_SUPERADMIN_PASSWORD, { type: argon2.argon2id }),
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
        userAgent: "cli",
      },
    });
  });
  console.log(`Reset ${user.email}. Sign in with SEED_SUPERADMIN_PASSWORD and set a new password and 2FA.`);
}

main().finally(() => prisma.$disconnect());
