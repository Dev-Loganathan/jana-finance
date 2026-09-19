import type { Permission } from "@jana/shared";
import { useCan } from "@/auth/permissions";

/** Hides children unless the current user holds the permission(s). Cosmetic only. */
export function PermissionGate({
  permission,
  mode = "all",
  fallback = null,
  children,
}: {
  permission: Permission | readonly Permission[];
  mode?: "all" | "any";
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const can = useCan();
  return <>{can(permission, mode) ? children : fallback}</>;
}
