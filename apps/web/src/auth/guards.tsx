import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { Permission } from "@jana/shared";
import { useAuth } from "./auth-context";
import { useCan } from "./permissions";
import { Skeleton } from "@/components/ui/skeleton";
import Setup from "@/pages/Setup";

/** Requires a signed-in user. Users with a pending password change / 2FA setup only ever see the setup screen. */
export function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === "loading")
    return (
      <div className="p-8">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  if (state.status === "anon") return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (state.user.mustChangePassword || state.user.requiresTotpSetup) return <Setup />;
  return <Outlet />;
}

export function RequirePermission({ anyOf }: { anyOf: Permission[] }) {
  const can = useCan();
  if (!can(anyOf, "any")) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold">Access denied</h1>
        <p className="mt-1 text-fg-muted">You do not have permission to view this page.</p>
      </div>
    );
  }
  return <Outlet />;
}
