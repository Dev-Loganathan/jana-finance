import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { authenticator } from "otplib";
import { PASSWORD, ensureRoles, login, makeApp, makeUser, prisma, token, uniq } from "./helpers";

describe("auth", () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await makeApp();
    await ensureRoles();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("logs in, sets an httpOnly refresh cookie and never leaks secrets", async () => {
    const u = await makeUser(app, "staff");
    const res = await login(app, u);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeUndefined();
    const cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;
    expect(cookie).toMatch(/jana_rt=.+HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|totpSecret/);
    expect(res.body.user.permissions).toContain("customer:view");
  });

  it("gives the same error for wrong password and unknown email", async () => {
    const u = await makeUser(app, "staff");
    const a = await login(app, u, "Wrong!Passw0rd#9");
    const b = await http().post("/auth/login").send({ email: "nobody@test.local", password: PASSWORD });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it("locks the account after repeated failures, even for the right password", async () => {
    const u = await makeUser(app, "staff");
    for (let i = 0; i < 5; i++) expect((await login(app, u, "Wrong!Passw0rd#9")).status).toBe(401);
    const res = await login(app, u);
    expect(res.status).toBe(423);
    expect(res.body.code).toBe("ACCOUNT_LOCKED");
  });

  it("rotates refresh tokens and revokes the family when an old one is replayed", async () => {
    const u = await makeUser(app, "staff");
    const first = await login(app, u);
    const rt1 = (first.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;

    const second = await http().post("/auth/refresh").set("Cookie", rt1);
    expect(second.status).toBe(200);
    const rt2 = (second.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
    expect(rt2).not.toBe(rt1);

    // Replaying the rotated token is treated as theft ...
    expect((await http().post("/auth/refresh").set("Cookie", rt1)).status).toBe(401);
    // ... and kills the new token too.
    expect((await http().post("/auth/refresh").set("Cookie", rt2)).status).toBe(401);
  });

  it("blocks everything except setup endpoints until the password is changed", async () => {
    const u = await makeUser(app, "staff", { mustChangePassword: true });
    const h = await token(app, u);
    const blocked = await http().get("/auth/sessions").set(h);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("SETUP_REQUIRED");
    expect((await http().get("/auth/me").set(h)).status).toBe(200);

    const weak = await http()
      .post("/auth/change-password")
      .set(h)
      .send({ currentPassword: PASSWORD, newPassword: "short" });
    expect(weak.status).toBe(400);
    const ok = await http()
      .post("/auth/change-password")
      .set(h)
      .send({ currentPassword: PASSWORD, newPassword: "An0ther!Passw0rd#2" });
    expect(ok.status).toBe(204);
    expect((await http().get("/auth/sessions").set(h)).status).toBe(200);
  });

  it("requires 2FA for the Super Admin: setup gate, then a TOTP code at login", async () => {
    const u = await makeUser(app, "super_admin");
    const h = await token(app, u);
    expect((await http().get("/users").set(h)).body.code).toBe("SETUP_REQUIRED");

    const setup = await http().post("/auth/2fa/setup").set(h);
    expect(setup.status).toBe(201);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    // Asking again before enabling returns the same secret, so overlapping requests cannot desynchronise the QR code
    const again = await http().post("/auth/2fa/setup").set(h);
    expect(again.body.secret).toBe(setup.body.secret);
    expect((await http().post("/auth/2fa/enable").set(h).send({ code: "000000" })).status).toBe(400);
    expect(
      (
        await http()
          .post("/auth/2fa/enable")
          .set(h)
          .send({ code: authenticator.generate(setup.body.secret) })
      ).status,
    ).toBe(204);
    expect((await http().get("/users").set(h)).status).toBe(200);

    const noCode = await login(app, u);
    expect(noCode.status).toBe(401);
    expect(noCode.body.code).toBe("TOTP_REQUIRED");
    const withCode = await http()
      .post("/auth/login")
      .send({ email: u.email, password: PASSWORD, totp: authenticator.generate(setup.body.secret) });
    expect(withCode.status).toBe(200);
  });

  it("takes effect immediately when a user is suspended", async () => {
    const admin = await makeUser(app, "super_admin", { totp: true });
    const victim = await makeUser(app, "staff");
    const vh = await token(app, victim);
    expect((await http().get("/auth/me").set(vh)).status).toBe(200);

    const res = await http()
      .post(`/users/${victim.id}/suspend`)
      .set(await token(app, admin));
    expect(res.status).toBe(200);
    expect((await http().get("/auth/me").set(vh)).status).toBe(401);
    expect((await login(app, victim)).status).toBe(401);
  });

  it("supports the invite flow: invited users cannot log in until they set a password", async () => {
    const admin = await makeUser(app, "super_admin", { totp: true });
    const staffRole = await prisma.role.findUniqueOrThrow({ where: { key: "staff" } });
    const email = `${uniq("invitee")}@test.local`;

    const { MailService } = await import("../src/mail/mail.service");
    const sent: string[] = [];
    jest.spyOn(app.get(MailService), "send").mockImplementation(async (_to, _s, body) => void sent.push(body));

    const res = await http()
      .post("/users")
      .set(await token(app, admin))
      .send({ firstName: "New", email, phone: "98765 43210", roleId: staffRole.id, mode: "invite" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("INVITED");
    expect(res.body.phone).toBe("9876543210");
    expect((await http().post("/auth/login").send({ email, password: PASSWORD })).status).toBe(401);

    const t = /token=([\w-]+)/.exec(sent[0]!)![1]!;
    expect((await http().post("/auth/accept-token").send({ token: t, password: PASSWORD })).status).toBe(204);
    expect((await http().post("/auth/accept-token").send({ token: t, password: PASSWORD })).status).toBe(400); // single use
    expect((await http().post("/auth/login").send({ email, password: PASSWORD })).status).toBe(200);
  });
});
