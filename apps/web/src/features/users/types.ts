import type { Permission } from "@jana/shared";

export interface UserRow {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string;
  employeeCode: string | null;
  status: "ACTIVE" | "SUSPENDED" | "INVITED";
  role: { id: string; name: string; locked: boolean };
  totpEnabled: boolean;
  lastLoginAt: string | null;
}

export interface RoleRow {
  id: string;
  name: string;
  description: string;
  system: boolean;
  locked: boolean;
  dataScope: "ALL" | "BRANCH" | "ASSIGNED";
  permissions: Permission[];
  userCount?: number;
}

export type PermissionCatalog = Record<string, readonly string[]>;
