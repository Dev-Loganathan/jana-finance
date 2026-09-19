/**
 * Permission catalog. Format is `module:action` (colon), matching the existing app.
 * Roles are data (DB rows); this catalog is the only source of valid permission keys.
 */
export const PERMISSION_GROUPS = {
  customer: ["view", "create", "edit", "delete", "export", "import", "blacklist"],
  kyc: ["view", "upload", "verify", "reject", "reveal_sensitive"],
  chit: ["view", "create", "edit", "member_assign", "auction_conduct", "payout_approve"],
  loan: ["view", "create", "edit", "approve", "disburse", "close", "waive_penalty"],
  payment: ["view", "create", "reverse", "backdate"],
  expense: ["view", "manage"],
  report: ["view", "export"],
  notification: ["view", "send"],
  user: ["view", "manage"],
  role: ["view", "manage"],
  audit: ["view"],
  settings: ["view", "manage"],
} as const;

export type PermissionGroup = keyof typeof PERMISSION_GROUPS;

type Join<G extends PermissionGroup> = `${G}:${(typeof PERMISSION_GROUPS)[G][number]}`;
export type Permission = { [G in PermissionGroup]: Join<G> }[PermissionGroup];

export const ALL_PERMISSIONS: readonly Permission[] = (
  Object.entries(PERMISSION_GROUPS) as [PermissionGroup, readonly string[]][]
).flatMap(([group, actions]) => actions.map((a) => `${group}:${a}` as Permission));

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}

export type DataScope = "ALL" | "BRANCH" | "ASSIGNED";

export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  /** System roles are tagged "System" in the UI. */
  system: boolean;
  /** Only the Super Admin role is locked: cannot be edited, deleted, or assigned through the UI. */
  locked: boolean;
  dataScope: DataScope;
  permissions: readonly Permission[];
}

const without = (drop: readonly Permission[]) => ALL_PERMISSIONS.filter((p) => !drop.includes(p));

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    key: "super_admin",
    name: "Super Admin",
    description: "Full system access including user management",
    system: true,
    locked: true,
    dataScope: "ALL",
    permissions: ALL_PERMISSIONS,
  },
  {
    key: "admin",
    name: "Admin",
    description: "Full business access without user management",
    system: true,
    locked: false,
    dataScope: "ALL",
    permissions: without(["user:manage", "role:manage", "settings:manage", "payment:backdate"]),
  },
  {
    key: "staff",
    name: "Staff",
    description: "Day-to-day operations with limited access",
    system: true,
    locked: false,
    dataScope: "ALL",
    permissions: [
      "customer:view",
      "customer:create",
      "customer:edit",
      "kyc:view",
      "kyc:upload",
      "loan:view",
      "chit:view",
      "payment:view",
      "payment:create",
    ],
  },
  {
    key: "manager",
    name: "Manager",
    description: "Oversees customers, approvals and reports",
    system: false,
    locked: false,
    dataScope: "ALL",
    permissions: [
      "customer:view",
      "customer:create",
      "customer:edit",
      "customer:export",
      "kyc:view",
      "kyc:verify",
      "kyc:reject",
      "loan:view",
      "loan:approve",
      "chit:view",
      "payment:view",
      "report:view",
    ],
  },
];
