import type { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { authenticator } from "otplib";
import * as argon2 from "argon2";
import request from "supertest";
import { ROLE_TEMPLATES } from "@jana/shared";
import { createApp } from "../src/app.factory";
import { CryptoService } from "../src/common/crypto.service";

export const PASSWORD = "Str0ng!Passw0rd#1";
export const prisma = new PrismaClient();
let counter = 0;
export const uniq = (p = "u") => `${p}${Date.now().toString(36)}${counter++}`;

export async function makeApp() {
  const app = await createApp();
  await app.init();
  return app;
}

/** Ensure the default role rows exist (same templates the seed uses). */
export async function ensureRoles() {
  for (const t of ROLE_TEMPLATES) {
    await prisma.role.upsert({
      where: { key: t.key },
      create: {
        key: t.key,
        name: t.name,
        description: t.description,
        system: t.system,
        locked: t.locked,
        dataScope: t.dataScope,
        permissions: [...t.permissions],
      },
      update: { permissions: [...t.permissions] },
    });
  }
}

export interface TestUser {
  id: string;
  email: string;
  totpSecret?: string;
}

export async function makeUser(
  app: INestApplication,
  roleKey: string,
  opts: { totp?: boolean; mustChangePassword?: boolean; status?: "ACTIVE" | "SUSPENDED" | "INVITED" } = {},
): Promise<TestUser> {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const secret = opts.totp ? authenticator.generateSecret() : undefined;
  const email = `${uniq(roleKey)}@test.local`;
  const u = await prisma.user.create({
    data: {
      firstName: "Test",
      lastName: roleKey,
      email,
      phone: "9876543210",
      passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      roleId: role.id,
      status: opts.status ?? "ACTIVE",
      mustChangePassword: opts.mustChangePassword ?? false,
      totpEnabled: !!secret,
      totpSecretEnc: secret ? app.get(CryptoService).encrypt(secret) : null,
    },
  });
  return { id: u.id, email, totpSecret: secret };
}

export async function login(app: INestApplication, u: TestUser, password = PASSWORD) {
  const body: Record<string, string> = { email: u.email, password };
  if (u.totpSecret) body.totp = authenticator.generate(u.totpSecret);
  const res = await request(app.getHttpServer()).post("/auth/login").send(body);
  return res;
}

/** Login and return a ready-to-use Authorization header. */
export async function token(app: INestApplication, u: TestUser) {
  const res = await login(app, u);
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { Authorization: `Bearer ${res.body.accessToken}` };
}
