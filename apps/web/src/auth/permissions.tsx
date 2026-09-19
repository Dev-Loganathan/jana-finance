import { createContext, useContext, useMemo } from "react";
import type { Permission } from "@jana/shared";

/**
 * Permissions come from the login response (same list the API enforces).
 * UI checks are cosmetic; the server authorizes every request.
 */
const PermissionContext = createContext<ReadonlySet<Permission>>(new Set());

export function PermissionProvider({
  permissions,
  children,
}: {
  permissions: readonly Permission[];
  children: React.ReactNode;
}) {
  const set = useMemo(() => new Set(permissions), [permissions]);
  return <PermissionContext.Provider value={set}>{children}</PermissionContext.Provider>;
}

export function useCan() {
  const set = useContext(PermissionContext);
  return (perm: Permission | readonly Permission[], mode: "all" | "any" = "all") => {
    const list = Array.isArray(perm) ? perm : [perm as Permission];
    return mode === "all" ? list.every((p) => set.has(p)) : list.some((p) => set.has(p));
  };
}
