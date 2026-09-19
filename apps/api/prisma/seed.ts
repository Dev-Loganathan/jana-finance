import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { ROLE_TEMPLATES } from "@jana/shared";
import { env } from "../src/config/env";

env(); // loads .env before Prisma reads DATABASE_URL
const prisma = new PrismaClient();

/** Idempotent. Re-running never overwrites roles the owner customised, except Super Admin which always gets every permission. */
async function main() {
  for (const t of ROLE_TEMPLATES) {
    const data = {
      name: t.name,
      description: t.description,
      system: t.system,
      locked: t.locked,
      dataScope: t.dataScope,
      permissions: [...t.permissions],
    };
    await prisma.role.upsert({
      where: { key: t.key },
      create: { key: t.key, ...data },
      update: t.locked ? { permissions: data.permissions } : {},
    });
  }

  const superRole = await prisma.role.findUniqueOrThrow({ where: { key: "super_admin" } });
  const existing = await prisma.user.findFirst({ where: { roleId: superRole.id } });
  if (existing) {
    console.log(`Super Admin already exists (${existing.email}); leaving it untouched.`);
    return;
  }
  const e = env();
  await prisma.user.create({
    data: {
      firstName: "Super",
      lastName: "Admin",
      email: e.SEED_SUPERADMIN_EMAIL.toLowerCase(),
      phone: "9000000000",
      passwordHash: await argon2.hash(e.SEED_SUPERADMIN_PASSWORD, { type: argon2.argon2id }),
      roleId: superRole.id,
      mustChangePassword: true,
    },
  });
  console.log(
    `Created Super Admin ${e.SEED_SUPERADMIN_EMAIL}. You must change the password and set up 2FA on first login.`,
  );
}

main().finally(() => prisma.$disconnect());
