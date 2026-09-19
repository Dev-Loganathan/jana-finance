import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Paged } from "@jana/shared";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/form";

interface AuditRow {
  id: string;
  at: string;
  userEmail: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  ip: string | null;
}

export default function AuditLog() {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => (setQ(search), setPage(1)), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ["audit", { q, page }],
    queryFn: () => api<Paged<AuditRow>>("/audit", { query: { q, page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<AuditRow>[]>(
    () => [
      {
        accessorKey: "at",
        header: "When",
        enableSorting: false,
        cell: ({ getValue }) => (
          <span className="tabular whitespace-nowrap text-xs">{formatDateTime(getValue<string>())}</span>
        ),
      },
      {
        accessorKey: "userEmail",
        header: "Who",
        enableSorting: false,
        cell: ({ getValue }) => getValue<string | null>() ?? <span className="text-fg-muted">System</span>,
      },
      {
        accessorKey: "action",
        header: "Action",
        enableSorting: false,
        cell: ({ getValue }) => <code className="text-xs">{getValue<string>()}</code>,
      },
      { accessorKey: "entity", header: "Entity", enableSorting: false },
      {
        accessorKey: "ip",
        header: "IP",
        enableSorting: false,
        cell: ({ getValue }) => (
          <span className="tabular text-xs text-fg-muted">{getValue<string | null>() ?? "-"}</span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Audit Log</h1>
        <p className="text-fg-muted">Append-only record of who did what. It cannot be edited or deleted.</p>
      </div>
      <div className="max-w-xs">
        <Input
          aria-label="Search audit log"
          placeholder="Search action, user, entity…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        loading={isLoading}
        page={page}
        pageSize={25}
        total={data?.total ?? 0}
        onPageChange={setPage}
        emptyTitle="No matching events"
      />
    </div>
  );
}
