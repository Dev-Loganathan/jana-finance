import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import type { Paged } from "@jana/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/form";
import { PermissionGate } from "@/components/ui/permission-gate";
import type { ChitGroupSummary, ChitStatus } from "@/features/chits/types";
import { ChitStatusBadge, TYPE_LABEL, inr } from "@/features/chits/ui";

const FILTERS: { key: "" | ChitStatus; label: string }[] = [
  { key: "", label: "All" },
  { key: "RUNNING", label: "Running" },
  { key: "OPEN_FOR_ENROLMENT", label: "Open for enrolment" },
  { key: "DRAFT", label: "Draft" },
  { key: "COMPLETED", label: "Completed" },
  { key: "CANCELLED", label: "Cancelled" },
];

export default function Chits() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"" | ChitStatus>("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(() => ({ q, page, pageSize: 20, status: status || undefined }), [q, page, status]);
  const list = useQuery({
    queryKey: ["chits", "list", query],
    queryFn: () => api<Paged<ChitGroupSummary>>("/chits", { query }),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<ChitGroupSummary>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Group",
        enableSorting: false,
        cell: ({ row: { original: g } }) => (
          <div>
            <Link to={`/chits/${g.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
              {g.name}
            </Link>
            <div className="text-xs text-fg-muted">
              {g.code} · {TYPE_LABEL[g.type]}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "chitValuePaise",
        header: "Chit value",
        enableSorting: false,
        meta: { align: "right" },
        cell: ({ row: { original: g } }) => <span className="tabular">{inr(g.chitValuePaise)}</span>,
      },
      {
        accessorKey: "monthlySubscriptionPaise",
        header: "Monthly",
        enableSorting: false,
        meta: { align: "right" },
        cell: ({ row: { original: g } }) => <span className="tabular">{inr(g.monthlySubscriptionPaise)}</span>,
      },
      {
        id: "members",
        header: "Members",
        enableSorting: false,
        cell: ({ row: { original: g } }) => (
          <span className="tabular">
            {g.filled ?? 0} / {g.members}
          </span>
        ),
      },
      {
        id: "progress",
        header: "Auctions held",
        enableSorting: false,
        cell: ({ row: { original: g } }) => (
          <span className="tabular">
            {g.closedMonths ?? 0} / {g.durationMonths}
          </span>
        ),
      },
      {
        accessorKey: "startDate",
        header: "Starts",
        enableSorting: false,
        cell: ({ getValue }) => <span className="tabular text-fg-muted">{getValue<string>()}</span>,
      },
      {
        accessorKey: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row: { original: g } }) => <ChitStatusBadge status={g.status} />,
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Chit Funds</h1>
          <p className="text-fg-muted">Groups, members, monthly auctions, collections and prize payouts</p>
        </div>
        <PermissionGate permission="chit:create">
          <Button asChild>
            <Link to="/chits/new">
              <Plus className="h-4 w-4" aria-hidden /> New Chit Group
            </Link>
          </Button>
        </PermissionGate>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="space-y-3 p-4">
          <div className="relative max-w-xl">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
              aria-hidden
            />
            <Input
              aria-label="Search chit groups"
              className="pl-9"
              placeholder="Search by name or code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Status filter">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                aria-pressed={status === f.key}
                onClick={() => {
                  setStatus(f.key);
                  setPage(1);
                }}
                className={cn(
                  "min-h-8 rounded-full border px-3 text-xs font-medium",
                  status === f.key
                    ? "border-primary bg-primary text-fg-inverse"
                    : "border-border hover:bg-surface-muted",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <DataTable
          columns={columns}
          data={list.data?.items ?? []}
          loading={list.isLoading}
          page={page}
          pageSize={20}
          total={list.data?.total ?? 0}
          onPageChange={setPage}
          onRowClick={(g) => navigate(`/chits/${g.id}`)}
          emptyTitle={q || status ? "No chit groups match" : "No chit groups yet"}
          emptyDescription={!q && !status ? "Create your first chit group to get started." : undefined}
        />
      </div>
    </div>
  );
}
