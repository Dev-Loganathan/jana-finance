import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { ADMIN_DB_URL, TEST_DB_URL } from "./test-env";

/** Creates the jana_test database if needed and applies all migrations. */
export default async function setup() {
  const admin = new PrismaClient({ datasources: { db: { url: ADMIN_DB_URL } } });
  try {
    await admin.$executeRawUnsafe("CREATE DATABASE jana_test");
  } catch {
    /* already exists */
  } finally {
    await admin.$disconnect();
  }
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: TEST_DB_URL }, stdio: "pipe" });
}
