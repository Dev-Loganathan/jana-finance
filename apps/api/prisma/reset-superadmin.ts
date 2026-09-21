import { PrismaClient } from "@prisma/client";
import { resetSuperAdmin } from "../src/auth/break-glass";
import { env } from "../src/config/env";

/**
 * Break-glass recovery for the Super Admin account. From a shell on the server:
 *   pnpm --filter @jana/api superadmin:reset
 * Resets the password to SEED_SUPERADMIN_PASSWORD, clears any lockout, removes 2FA (set it up again), signs out every
 * session and forces a password change at the next sign-in. On a host with no shell the start script runs this when
 * RESET_SUPERADMIN is set, once per value (RESET_TOKEN). The action is written to the audit log.
 */
env(); // load .env before Prisma reads DATABASE_URL
const prisma = new PrismaClient();

async function main() {
  const token = process.env.RESET_TOKEN || undefined;
  const r = await resetSuperAdmin(prisma, { password: env().SEED_SUPERADMIN_PASSWORD, token });
  console.log(
    r.applied
      ? `Reset ${r.email}. Sign in with SEED_SUPERADMIN_PASSWORD and set a new password and 2FA.`
      : `Reset "${token}" was already applied to ${r.email}; nothing changed. Use a new RESET_SUPERADMIN value to reset again.`,
  );
}

main().finally(() => prisma.$disconnect());
