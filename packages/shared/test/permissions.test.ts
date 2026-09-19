import { ALL_PERMISSIONS, ROLE_TEMPLATES, isPermission } from "../src";

describe("permissions", () => {
  it("uses module:action format with no duplicates", () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    for (const p of ALL_PERMISSIONS) expect(p).toMatch(/^[a-z]+:[a-z_]+$/);
  });

  it("validates keys", () => {
    expect(isPermission("customer:view")).toBe(true);
    expect(isPermission("customer.view")).toBe(false);
  });

  it("role templates only reference known permissions", () => {
    for (const role of ROLE_TEMPLATES) {
      for (const p of role.permissions) expect(isPermission(p)).toBe(true);
    }
  });

  it("only Super Admin is locked, has everything, and Admin lacks user management", () => {
    const locked = ROLE_TEMPLATES.filter((r) => r.locked);
    expect(locked.map((r) => r.key)).toEqual(["super_admin"]);
    expect(locked[0]!.permissions).toHaveLength(ALL_PERMISSIONS.length);
    const admin = ROLE_TEMPLATES.find((r) => r.key === "admin")!;
    expect(admin.permissions).not.toContain("user:manage");
  });
});
