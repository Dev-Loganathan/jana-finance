import { PrismaClient } from "@prisma/client";

/**
 * Drops and recreates a database. Used by the e2e suite for a clean slate.
 * Usage: ADMIN_DATABASE_URL=postgresql://.../postgres ts-node test/reset-db.ts jana_e2e
 */
async function main() {
  const name = process.argv[2];
  if (!name || !/^[a-z0-9_]+$/.test(name)) throw new Error("Pass a simple database name, e.g. jana_e2e");
  if (!name.includes("e2e") && !name.includes("test"))
    throw new Error("Refusing to reset a database whose name does not contain e2e or test");
  const admin = new PrismaClient({ datasources: { db: { url: process.env.ADMIN_DATABASE_URL } } });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE ${name}`);
  } finally {
    await admin.$disconnect();
  }
}
void main();
