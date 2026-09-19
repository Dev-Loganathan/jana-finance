import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/ui/permission-gate";
import { Skeleton } from "@/components/ui/skeleton";
import { RoleFormModal } from "./RoleFormModal";
import type { RoleRow } from "./types";

const SHOWN = 6;

export function RolesTab() {
  const { data: roles, isLoading } = useQuery({ queryKey: ["roles"], queryFn: () => api<RoleRow[]>("/roles") });
  const [modal, setModal] = useState<{ open: boolean; role?: RoleRow }>({ open: false });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Roles</h2>
        <PermissionGate permission="role:manage">
          <Button variant="secondary" onClick={() => setModal({ open: true })}>
            <Plus className="h-4 w-4" aria-hidden /> New Role
          </Button>
        </PermissionGate>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
        {roles?.map((r) => (
          <article key={r.id} className="flex flex-col rounded-lg border border-border bg-surface p-5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-lg font-semibold">{r.name}</h3>
              {(r.system || r.locked) && (
                <span className="rounded-full border border-border px-2 py-0.5 text-xs">System</span>
              )}
            </div>
            <p className="mt-1 text-sm text-fg-muted">{r.description || "No description"}</p>
            <p className="tabular mt-3 text-xs text-fg-muted">
              {r.permissions.length} permissions · {r.userCount ?? 0} {r.userCount === 1 ? "user" : "users"}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {r.permissions.slice(0, SHOWN).map((p) => (
                <span key={p} className="rounded bg-surface-muted px-2 py-0.5 font-mono text-[11px]">
                  {p}
                </span>
              ))}
              {r.permissions.length > SHOWN && (
                <span className="rounded bg-surface-muted px-2 py-0.5 text-[11px]">
                  +{r.permissions.length - SHOWN} more
                </span>
              )}
            </div>
            <Button
              variant="secondary"
              className="mt-auto w-full"
              onClick={() => setModal({ open: true, role: r })}
              aria-label={`${r.locked ? "View" : "Edit"} permissions for ${r.name}`}
            >
              <Pencil className="h-4 w-4" aria-hidden /> {r.locked ? "View Permissions" : "Edit Permissions"}
            </Button>
          </article>
        ))}
      </div>

      {modal.open && (
        <RoleFormModal
          key={modal.role?.id ?? "new"}
          open
          onOpenChange={(o) => setModal({ open: o })}
          role={modal.role}
        />
      )}
    </div>
  );
}
