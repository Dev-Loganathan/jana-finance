import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { ALL_PERMISSIONS } from "@jana/shared";
import { ensureRoles, makeApp, makeUser, prisma, token, uniq, type TestUser } from "./helpers";

const ANY_ID = "00000000-0000-4000-8000-000000000000";

/** Every protected endpoint and the permission it needs. A role lacking it must get 403; no token must get 401. */
const ENDPOINTS: { method: "get" | "post" | "patch" | "delete"; path: string; perm: string }[] = [
  { method: "get", path: "/users", perm: "user:view" },
  { method: "get", path: `/users/${ANY_ID}`, perm: "user:view" },
  { method: "post", path: "/users", perm: "user:manage" },
  { method: "patch", path: `/users/${ANY_ID}`, perm: "user:manage" },
  { method: "post", path: `/users/${ANY_ID}/suspend`, perm: "user:manage" },
  { method: "post", path: `/users/${ANY_ID}/activate`, perm: "user:manage" },
  { method: "post", path: `/users/${ANY_ID}/reset-password`, perm: "user:manage" },
  { method: "post", path: `/users/${ANY_ID}/revoke-sessions`, perm: "user:manage" },
  { method: "delete", path: `/users/${ANY_ID}`, perm: "user:manage" },
  { method: "get", path: "/roles", perm: "role:view" },
  { method: "get", path: "/permissions", perm: "role:view" },
  { method: "post", path: "/roles", perm: "role:manage" },
  { method: "patch", path: `/roles/${ANY_ID}`, perm: "role:manage" },
  { method: "delete", path: `/roles/${ANY_ID}`, perm: "role:manage" },
  { method: "get", path: "/audit", perm: "audit:view" },
];

describe("rbac", () => {
  let app: INestApplication;
  let superAdmin: TestUser;
  let staff: TestUser;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await makeApp();
    await ensureRoles();
    superAdmin = await makeUser(app, "super_admin", { totp: true });
    staff = await makeUser(app, "staff");
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("every catalog permission used by an endpoint exists", () => {
    for (const e of ENDPOINTS) expect(ALL_PERMISSIONS).toContain(e.perm);
  });

  describe.each(ENDPOINTS)("$method $path", ({ method, path }) => {
    it("401 without a token", async () => {
      expect((await http()[method](path)).status).toBe(401);
    });
    it("403 for a role without the permission", async () => {
      const res = await http()
        [method](path)
        .set(await token(app, staff))
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    });
  });

  it("public health endpoint works without a token", async () => {
    expect((await http().get("/health")).status).toBe(200);
  });

  describe("Super Admin protection", () => {
    it("cannot be assigned through the create-user form", async () => {
      const role = await prisma.role.findUniqueOrThrow({ where: { key: "super_admin" } });
      const res = await http()
        .post("/users")
        .set(await token(app, superAdmin))
        .send({
          firstName: "X",
          email: `${uniq("x")}@test.local`,
          phone: "9876543210",
          roleId: role.id,
          mode: "password",
          password: "Str0ng!Passw0rd#1",
        });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PROTECTED");
    });

    it("cannot be suspended, edited, reset or deleted by another admin", async () => {
      const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "admin" } });
      const custom = await prisma.role.create({
        data: { name: uniq("UserMgr"), permissions: ["user:view", "user:manage"] },
      });
      const mgr = await makeUser(app, "staff");
      await prisma.user.update({ where: { id: mgr.id }, data: { roleId: custom.id } });
      const h = await token(app, mgr);

      expect((await http().post(`/users/${superAdmin.id}/suspend`).set(h)).body.code).toBe("PROTECTED");
      expect((await http().patch(`/users/${superAdmin.id}`).set(h).send({ roleId: adminRole.id })).body.code).toBe(
        "PROTECTED",
      );
      expect((await http().post(`/users/${superAdmin.id}/reset-password`).set(h)).body.code).toBe("PROTECTED");
      expect((await http().delete(`/users/${superAdmin.id}`).set(h)).body.code).toBe("PROTECTED");
    });

    it("the Super Admin cannot suspend or delete themselves", async () => {
      const h = await token(app, superAdmin);
      expect((await http().post(`/users/${superAdmin.id}/suspend`).set(h)).status).toBe(403);
      expect((await http().delete(`/users/${superAdmin.id}`).set(h)).status).toBe(403);
    });

    it("the Super Admin role cannot be edited or deleted", async () => {
      const role = await prisma.role.findUniqueOrThrow({ where: { key: "super_admin" } });
      const h = await token(app, superAdmin);
      expect((await http().patch(`/roles/${role.id}`).set(h).send({ permissions: [] })).body.code).toBe("PROTECTED");
      expect((await http().delete(`/roles/${role.id}`).set(h)).body.code).toBe("PROTECTED");
    });
  });

  describe("privilege escalation", () => {
    it("a user manager cannot assign a role holding permissions they lack", async () => {
      const custom = await prisma.role.create({
        data: { name: uniq("UserMgr"), permissions: ["user:view", "user:manage", "role:view"] },
      });
      const mgr = await makeUser(app, "staff");
      await prisma.user.update({ where: { id: mgr.id }, data: { roleId: custom.id } });
      const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "admin" } });
      const res = await http()
        .post("/users")
        .set(await token(app, mgr))
        .send({
          firstName: "Y",
          email: `${uniq("y")}@test.local`,
          phone: "9876543210",
          roleId: adminRole.id,
          mode: "password",
          password: "Str0ng!Passw0rd#1",
        });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ESCALATION");
    });

    it("a role manager cannot grant permissions they do not hold", async () => {
      const custom = await prisma.role.create({
        data: { name: uniq("RoleMgr"), permissions: ["role:view", "role:manage"] },
      });
      const mgr = await makeUser(app, "staff");
      await prisma.user.update({ where: { id: mgr.id }, data: { roleId: custom.id } });
      const res = await http()
        .post("/roles")
        .set(await token(app, mgr))
        .send({ name: uniq("Sneaky"), permissions: ["loan:approve"] });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ESCALATION");
    });
  });

  describe("roles CRUD", () => {
    it("creates, updates and deletes a custom role; refuses deleting one in use", async () => {
      const h = await token(app, superAdmin);
      const created = await http()
        .post("/roles")
        .set(h)
        .send({ name: uniq("Branch Manager"), description: "d", permissions: ["customer:view", "customer:view"] });
      expect(created.status).toBe(201);
      expect(created.body.permissions).toEqual(["customer:view"]); // de-duplicated
      const id = created.body.id as string;

      expect(
        (
          await http()
            .patch(`/roles/${id}`)
            .set(h)
            .send({ permissions: ["customer:view", "loan:view"] })
        ).body.permissions,
      ).toHaveLength(2);
      expect(
        (
          await http()
            .post("/roles")
            .set(h)
            .send({ name: "x", permissions: ["not:real"] })
        ).status,
      ).toBe(400);

      const member = await makeUser(app, "staff");
      await prisma.user.update({ where: { id: member.id }, data: { roleId: id } });
      expect((await http().delete(`/roles/${id}`).set(h)).body.code).toBe("ROLE_IN_USE");
      await prisma.user.update({
        where: { id: member.id },
        data: { roleId: (await prisma.role.findUniqueOrThrow({ where: { key: "staff" } })).id },
      });
      expect((await http().delete(`/roles/${id}`).set(h)).status).toBe(204);
    });

    it("system roles cannot be deleted", async () => {
      const staffRole = await prisma.role.findUniqueOrThrow({ where: { key: "staff" } });
      expect(
        (
          await http()
            .delete(`/roles/${staffRole.id}`)
            .set(await token(app, superAdmin))
        ).body.code,
      ).toBe("PROTECTED");
    });
  });

  describe("users list", () => {
    it("paginates, searches and rejects bad queries", async () => {
      const h = await token(app, superAdmin);
      const marker = uniq("srch");
      await http()
        .post("/users")
        .set(h)
        .send({
          firstName: marker,
          email: `${marker}@test.local`,
          phone: "9876543210",
          roleId: (await prisma.role.findUniqueOrThrow({ where: { key: "staff" } })).id,
          mode: "password",
          password: "Str0ng!Passw0rd#1",
        });
      const res = await http().get("/users").query({ q: marker.toUpperCase(), pageSize: 5 }).set(h);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].firstName).toBe(marker);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|totpSecret/);
      expect((await http().get("/users").query({ pageSize: 1000 }).set(h)).status).toBe(400);
      expect((await http().get("/users").query({ sort: "email:asc" }).set(h)).status).toBe(200);
    });

    it("rejects weak passwords and duplicate emails", async () => {
      const h = await token(app, superAdmin);
      const role = await prisma.role.findUniqueOrThrow({ where: { key: "staff" } });
      const email = `${uniq("dup")}@test.local`;
      const base = { firstName: "D", email, phone: "9876543210", roleId: role.id, mode: "password" as const };
      expect(
        (
          await http()
            .post("/users")
            .set(h)
            .send({ ...base, password: "weakpass" })
        ).status,
      ).toBe(400);
      expect(
        (
          await http()
            .post("/users")
            .set(h)
            .send({ ...base, password: "Str0ng!Passw0rd#1" })
        ).status,
      ).toBe(201);
      expect(
        (
          await http()
            .post("/users")
            .set(h)
            .send({ ...base, password: "Str0ng!Passw0rd#1" })
        ).body.code,
      ).toBe("EMAIL_TAKEN");
    });
  });

  describe("audit log", () => {
    it("records who did what, without secrets, and cannot be modified or deleted", async () => {
      const h = await token(app, superAdmin);
      const email = `${uniq("aud")}@test.local`;
      const role = await prisma.role.findUniqueOrThrow({ where: { key: "staff" } });
      const created = await http().post("/users").set(h).send({
        firstName: "Aud",
        email,
        phone: "9876543210",
        roleId: role.id,
        mode: "password",
        password: "Str0ng!Passw0rd#1",
      });

      const rows = await prisma.auditLog.findMany({ where: { entityId: created.body.id, action: "user.create" } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.userId).toBe(superAdmin.id);
      expect(JSON.stringify(rows[0]!.after)).not.toMatch(/Passw0rd|passwordHash/);

      await expect(
        prisma.$executeRaw`UPDATE "AuditLog" SET action = 'tampered' WHERE id = ${rows[0]!.id}`,
      ).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRaw`DELETE FROM "AuditLog" WHERE id = ${rows[0]!.id}`).rejects.toThrow(/append-only/);

      const listed = await http().get("/audit").query({ q: "user.create" }).set(h);
      expect(listed.status).toBe(200);
      expect(listed.body.items.length).toBeGreaterThan(0);
    });
  });
});
