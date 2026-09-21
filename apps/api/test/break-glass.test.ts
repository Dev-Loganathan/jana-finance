import * as argon2 from "argon2";
import { resetSuperAdmin } from "../src/auth/break-glass";
import { ensureRoles, makeApp, makeUser, prisma, uniq } from "./helpers";

const TEMP = "Temp!Reset#Pass1";
const OWNERS = "Owner!Chosen#Pass2";

describe("Super Admin emergency reset", () => {
  let app: Awaited<ReturnType<typeof makeApp>>;
  const owner = async () => {
    const role = await prisma.role.findFirstOrThrow({ where: { locked: true } });
    return prisma.user.findFirstOrThrow({ where: { roleId: role.id, deletedAt: null }, orderBy: { createdAt: "asc" } });
  };

  beforeAll(async () => {
    app = await makeApp();
    await ensureRoles();
    await makeUser(app, "super_admin", { totp: true });
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("puts the temporary password back, clears the lock, removes 2FA and forces a change", async () => {
    const u = await owner();
    await prisma.user.update({
      where: { id: u.id },
      data: { failedLogins: 3, lockedUntil: new Date(Date.now() + 600_000), mustChangePassword: false },
    });
    const r = await resetSuperAdmin(prisma, { password: TEMP });
    expect(r).toEqual({ applied: true, email: u.email });
    const after = await owner();
    expect(await argon2.verify(after.passwordHash, TEMP)).toBe(true);
    expect(after).toMatchObject({
      failedLogins: 0,
      lockedUntil: null,
      mustChangePassword: true,
      totpEnabled: false,
      status: "ACTIVE",
    });
    expect(after.totpSecretEnc).toBeNull();
  });

  it("with a token, applies once: a restart with the switch still on leaves the owner's new password alone", async () => {
    const token = uniq("unlock");
    expect((await resetSuperAdmin(prisma, { password: TEMP, token })).applied).toBe(true);

    // the owner signs in, picks their own password and turns 2FA on
    const u = await owner();
    await prisma.user.update({
      where: { id: u.id },
      data: {
        passwordHash: await argon2.hash(OWNERS, { type: argon2.argon2id }),
        mustChangePassword: false,
        totpEnabled: true,
      },
    });

    // the free host sleeps and wakes the app: the start script runs the reset again with the same value
    for (let i = 0; i < 3; i++) expect((await resetSuperAdmin(prisma, { password: TEMP, token })).applied).toBe(false);
    const still = await owner();
    expect(await argon2.verify(still.passwordHash, OWNERS)).toBe(true);
    expect(still.totpEnabled).toBe(true);
    expect(still.mustChangePassword).toBe(false);

    // a new value is a new, deliberate reset
    expect((await resetSuperAdmin(prisma, { password: TEMP, token: uniq("unlock") })).applied).toBe(true);
    const reset = await owner();
    expect(await argon2.verify(reset.passwordHash, TEMP)).toBe(true);
    expect(reset.totpEnabled).toBe(false);
  });

  it("without a token it always applies, and every reset is in the audit log", async () => {
    const u = await owner();
    const before = await prisma.auditLog.count({ where: { action: "auth.break_glass_reset", entityId: u.id } });
    await resetSuperAdmin(prisma, { password: TEMP });
    await resetSuperAdmin(prisma, { password: TEMP });
    expect(await prisma.auditLog.count({ where: { action: "auth.break_glass_reset", entityId: u.id } })).toBe(
      before + 2,
    );
  });

  it("signs out every session", async () => {
    const u = await owner();
    const s = await prisma.session.create({
      data: {
        userId: u.id,
        familyId: "00000000-0000-4000-8000-000000000001",
        tokenHash: uniq("h"),
        expiresAt: new Date(Date.now() + 3_600_000),
        userAgent: "test",
      },
    });
    await resetSuperAdmin(prisma, { password: TEMP });
    const after = await prisma.session.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.revokedAt).not.toBeNull();
    expect(after.revokedReason).toBe("break_glass_reset");
  });
});
