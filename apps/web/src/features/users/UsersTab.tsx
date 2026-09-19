import { useEffect, useMemo, useState } from "react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, Pencil, ShieldOff, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import type { Paged } from "@jana/shared";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { PermissionGate } from "@/components/ui/permission-gate";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { UserFormModal } from "./UserFormModal";
import type { UserRow } from "./types";

type Action = { kind: "suspend" | "activate" | "reset" | "logout" | "delete"; user: UserRow };

const COPY: Record<
  Action["kind"],
  {
    title: string;
    confirm: string;
    destructive: boolean;
    desc: (u: UserRow) => string;
    path: (u: UserRow) => string;
    method: "POST" | "DELETE";
    done: string;
  }
> = {
  suspend: {
    title: "Suspend this user?",
    confirm: "Suspend",
    destructive: true,
    desc: (u) => `${u.name} will be signed out immediately and cannot log in until re-activated.`,
    path: (u) => `/users/${u.id}/suspend`,
    method: "POST",
    done: "User suspended",
  },
  activate: {
    title: "Re-activate this user?",
    confirm: "Activate",
    destructive: false,
    desc: (u) => `${u.name} will be able to log in again.`,
    path: (u) => `/users/${u.id}/activate`,
    method: "POST",
    done: "User activated",
  },
  reset: {
    title: "Send a password reset link?",
    confirm: "Send link",
    destructive: false,
    desc: (u) => `A reset link will be sent to ${u.email}.`,
    path: (u) => `/users/${u.id}/reset-password`,
    method: "POST",
    done: "Reset link sent",
  },
  logout: {
    title: "Force logout?",
    confirm: "Sign out everywhere",
    destructive: true,
    desc: (u) => `All of ${u.name}'s sessions will end immediately.`,
    path: (u) => `/users/${u.id}/revoke-sessions`,
    method: "POST",
    done: "Sessions revoked",
  },
  delete: {
    title: "Delete this user?",
    confirm: "Delete",
    destructive: true,
    desc: (u) => `${u.name} will lose access and be removed from the list. Their history stays in the audit log.`,
    path: (u) => `/users/${u.id}`,
    method: "DELETE",
    done: "User deleted",
  },
};

export function UsersTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [modal, setModal] = useState<{ open: boolean; user?: UserRow }>({ open: false });
  const [action, setAction] = useState<Action | null>(null);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const sort = sorting[0] ? `${sorting[0].id}:${sorting[0].desc ? "desc" : "asc"}` : undefined;
  const { data, isLoading } = useQuery({
    queryKey: ["users", { q, page, sort }],
    queryFn: () => api<Paged<UserRow>>("/users", { query: { q, page, pageSize: 20, sort } }),
    placeholderData: keepPreviousData,
  });

  const run = useMutation({
    mutationFn: (a: Action) => api(COPY[a.kind].path(a.user), { method: COPY[a.kind].method }),
    onSuccess: (_d, a) => {
      void qc.invalidateQueries({ queryKey: ["users"] });
      void qc.invalidateQueries({ queryKey: ["roles"] });
      toast({ tone: "success", title: COPY[a.kind].done, description: a.user.name });
      setAction(null);
    },
    onError: (e) => {
      toast({ tone: "danger", title: "Action failed", description: e instanceof Error ? e.message : undefined });
      setAction(null);
    },
  });

  const columns = useMemo<ColumnDef<UserRow>[]>(
    () => [
      {
        accessorKey: "firstName",
        header: "User",
        cell: ({ row: { original: u } }) => (
          <div>
            <div className="font-medium">{u.name}</div>
            <div className="text-xs text-fg-muted">{u.email}</div>
          </div>
        ),
      },
      {
        id: "role",
        header: "Role",
        enableSorting: false,
        cell: ({ row: { original: u } }) => (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs">{u.role.name}</span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row: { original: u } }) => <StatusBadge status={u.status} />,
      },
      {
        accessorKey: "lastLoginAt",
        header: "Last login",
        cell: ({ getValue }) => (
          <span className="tabular text-xs text-fg-muted">{formatDateTime(getValue<string | null>())}</span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        cell: ({ row: { original: u } }) => {
          // The Super Admin account is protected: no actions are offered (the API refuses them too).
          if (u.role.locked) return <span className="text-xs text-fg-muted">Protected</span>;
          const btn = "rounded-md p-2 hover:bg-surface-muted min-h-touch min-w-touch md:min-h-0 md:min-w-0";
          return (
            <PermissionGate permission="user:manage">
              <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className={btn}
                  aria-label={`Edit ${u.name}`}
                  onClick={() => setModal({ open: true, user: u })}
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                </button>
                {u.status === "SUSPENDED" ? (
                  <button
                    type="button"
                    className={btn}
                    aria-label={`Activate ${u.name}`}
                    onClick={() => setAction({ kind: "activate", user: u })}
                  >
                    <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
                  </button>
                ) : u.status === "ACTIVE" ? (
                  <button
                    type="button"
                    className={btn}
                    aria-label={`Suspend ${u.name}`}
                    onClick={() => setAction({ kind: "suspend", user: u })}
                  >
                    <ShieldOff className="h-4 w-4 text-danger" aria-hidden />
                  </button>
                ) : null}
                <button
                  type="button"
                  className={btn}
                  aria-label={`Send password reset to ${u.name}`}
                  onClick={() => setAction({ kind: "reset", user: u })}
                >
                  <KeyRound className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  className={btn}
                  aria-label={`Force logout ${u.name}`}
                  onClick={() => setAction({ kind: "logout", user: u })}
                >
                  <LogOut className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  className={btn}
                  aria-label={`Delete ${u.name}`}
                  onClick={() => setAction({ kind: "delete", user: u })}
                >
                  <Trash2 className="h-4 w-4 text-danger" aria-hidden />
                </button>
              </div>
            </PermissionGate>
          );
        },
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-full sm:max-w-xs">
          <Input
            aria-label="Search users"
            placeholder="Search users…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <PermissionGate permission="user:manage">
          <Button onClick={() => setModal({ open: true })}>
            <UserPlus className="h-4 w-4" aria-hidden /> Add User
          </Button>
        </PermissionGate>
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        loading={isLoading}
        sorting={sorting}
        onSortingChange={(s) => {
          setSorting(s);
          setPage(1);
        }}
        page={page}
        pageSize={20}
        total={data?.total ?? 0}
        onPageChange={setPage}
        emptyTitle={q ? "No users match your search" : "No users yet"}
      />

      {modal.open && (
        <UserFormModal
          key={modal.user?.id ?? "new"}
          open
          onOpenChange={(o) => setModal({ open: o })}
          user={modal.user}
        />
      )}
      {action && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setAction(null)}
          title={COPY[action.kind].title}
          description={COPY[action.kind].desc(action.user)}
          subjectLabel="User"
          customer={`${action.user.name} (${action.user.email})`}
          confirmLabel={COPY[action.kind].confirm}
          destructive={COPY[action.kind].destructive}
          loading={run.isPending}
          onConfirm={() => run.mutate(action)}
        />
      )}
    </div>
  );
}
