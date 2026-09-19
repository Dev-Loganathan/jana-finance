// Regenerates docs/permissions-matrix.md from the shared permission catalog. Build shared first.
const { ALL_PERMISSIONS, ROLE_TEMPLATES } = require("../packages/shared/dist");
let o =
  "# Permissions Matrix\n\nGenerated from `packages/shared/src/permissions.ts` (regenerate with `pnpm docs:permissions`). Format is `module:action`. Roles are data and can be changed in the UI; this shows the **default templates** created by the seed. Super Admin is locked. Nobody can grant a permission they do not hold.\n\n";
o +=
  "| Permission | " +
  ROLE_TEMPLATES.map((r) => r.name).join(" | ") +
  " |\n|---|" +
  ROLE_TEMPLATES.map(() => ":-:").join("|") +
  "|\n";
for (const p of ALL_PERMISSIONS)
  o += "| `" + p + "` | " + ROLE_TEMPLATES.map((r) => (r.permissions.includes(p) ? "✓" : "")).join(" | ") + " |\n";
require("fs").writeFileSync(require("path").join(__dirname, "../docs/permissions-matrix.md"), o);
