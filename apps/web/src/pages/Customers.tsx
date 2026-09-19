import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Download, Eye, Pencil, Plus, Search, Upload } from "lucide-react";
import type { Paged } from "@jana/shared";
import { api, apiUrl, download } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PermissionGate } from "@/components/ui/permission-gate";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { Avatar, CibilScore, KycBadge, RiskBadge, WatchBadge } from "@/features/customers/badges";
import { ImportDialog } from "@/features/customers/ImportDialog";
import type { CustomerListItem } from "@/features/customers/types";

const FILTERS = [
  { key: "all", label: "All", query: {} },
  { key: "active", label: "Active", query: { status: "ACTIVE" } },
  { key: "inactive", label: "Inactive", query: { status: "INACTIVE" } },
  { key: "high", label: "High Risk", query: { risk: "HIGH" } },
  { key: "excellent", label: "Excellent Category", query: { category: "EXCELLENT" } },
  { key: "750", label: "CIBIL 750+", query: { cibilMin: 750 } },
  { key: "watch", label: "Watchlist", query: { watch: "WATCHLIST" } },
  { key: "black", label: "Blacklisted", query: { watch: "BLACKLIST" } },
  { key: "600", label: "CIBIL <600", query: { cibilMax: 599 } },
] as const;

interface Stats {
  total: number;
  active: number;
  inactive: number;
  highRisk: number;
  drafts: number;
}

function StatCard({ label, value, tone }: { label: string; value: number | undefined; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className={cn("tabular mt-1 text-2xl font-semibold", tone)}>{value ?? "-"}</p>
    </div>
  );
}

export default function Customers() {
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<"all" | "drafts">("all");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => (setQ(search), setPage(1)), 300);
    return () => clearTimeout(t);
  }, [search]);

  const stats = useQuery({ queryKey: ["customers", "stats"], queryFn: () => api<Stats>("/customers/stats") });
  const sort = sorting[0] ? `${sorting[0].id}:${sorting[0].desc ? "desc" : "asc"}` : undefined;
  const query = useMemo(
    () => ({
      q,
      page,
      pageSize: 20,
      sort,
      ...(tab === "drafts" ? { status: "DRAFT" } : FILTERS.find((f) => f.key === filter)!.query),
    }),
    [q, page, sort, tab, filter],
  );
  const list = useQuery({
    queryKey: ["customers", "list", query],
    queryFn: () => api<Paged<CustomerListItem>>("/customers", { query }),
    placeholderData: keepPreviousData,
  });

  const create = useMutation({
    mutationFn: () => api<{ id: string }>("/customers", { method: "POST", body: {} }),
    onSuccess: (c) => navigate(`/customers/${c.id}/edit`),
    onError: () => toast({ tone: "danger", title: "Could not start a new customer" }),
  });

  const columns = useMemo<ColumnDef<CustomerListItem>[]>(
    () => [
      {
        accessorKey: "firstName",
        header: "Customer",
        cell: ({ row: { original: c } }) => (
          <div className="flex items-center gap-3">
            <Avatar name={c.name} url={c.photoUrl ? apiUrl(c.photoUrl) : null} />
            <div>
              <div className="flex items-center gap-2 font-medium">
                {c.name || <span className="text-fg-muted">Unnamed draft</span>}
                <WatchBadge status={c.watchStatus} />
              </div>
              <div className="text-xs text-fg-muted">{c.code}</div>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "phone",
        header: "Mobile",
        enableSorting: false,
        cell: ({ getValue }) => <span className="tabular">{getValue<string | null>() ?? "-"}</span>,
      },
      {
        accessorKey: "city",
        header: "City",
        enableSorting: false,
        cell: ({ getValue }) => getValue<string | null>() ?? "-",
      },
      {
        accessorKey: "occupationType",
        header: "Occupation",
        enableSorting: false,
        cell: ({ getValue }) => (
          <span className="text-fg-muted">
            {(getValue<string | null>() ?? "-")
              .replace(/_/g, " ")
              .toLowerCase()
              .replace(/^\w/, (c) => c.toUpperCase())}
          </span>
        ),
      },
      {
        accessorKey: "cibilScore",
        header: "CIBIL",
        cell: ({ getValue }) => <CibilScore score={getValue<number | null>()} />,
      },
      {
        accessorKey: "riskLevel",
        header: "Risk",
        cell: ({ getValue }) => <RiskBadge level={getValue<CustomerListItem["riskLevel"]>()} />,
      },
      {
        id: "kyc",
        header: "KYC",
        enableSorting: false,
        cell: ({ row: { original: c } }) => <KycBadge status={c.kycStatus} />,
      },
      { accessorKey: "status", header: "Status", cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        cell: ({ row: { original: c } }) => (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {c.status !== "DRAFT" && (
              <Link
                to={`/customers/${c.id}`}
                aria-label={`View ${c.name}`}
                className="min-h-touch min-w-touch rounded-md p-2 hover:bg-surface-muted md:min-h-0 md:min-w-0"
              >
                <Eye className="h-4 w-4" aria-hidden />
              </Link>
            )}
            <PermissionGate permission="customer:edit">
              <Link
                to={`/customers/${c.id}/edit`}
                aria-label={`${c.status === "DRAFT" ? "Continue" : "Edit"} ${c.name || c.code}`}
                className="min-h-touch min-w-touch rounded-md p-2 hover:bg-surface-muted md:min-h-0 md:min-w-0"
              >
                <Pencil className="h-4 w-4" aria-hidden />
              </Link>
            </PermissionGate>
          </div>
        ),
      },
    ],
    [],
  );

  const tabBtn = (key: "all" | "drafts", label: string) => (
    <button
      role="tab"
      aria-selected={tab === key}
      onClick={() => (setTab(key), setPage(1))}
      className={cn(
        "min-h-touch px-5 text-sm font-medium md:min-h-11",
        tab === key ? "bg-primary text-fg-inverse" : "text-fg-muted hover:bg-surface-muted",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Customers</h1>
          <p className="text-fg-muted">Manage your customer database: onboarding, KYC, profiles</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PermissionGate permission="customer:import">
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <Upload className="h-4 w-4" aria-hidden /> Import
            </Button>
          </PermissionGate>
          <PermissionGate permission="customer:export">
            <Button
              variant="secondary"
              onClick={() =>
                download(
                  "/customers/export",
                  { q, ...(tab === "drafts" ? { status: "DRAFT" } : FILTERS.find((f) => f.key === filter)!.query) },
                  "customers.csv",
                ).catch(() => toast({ tone: "danger", title: "Export failed" }))
              }
            >
              <Download className="h-4 w-4" aria-hidden /> Export
            </Button>
          </PermissionGate>
          <PermissionGate permission="customer:create">
            <Button onClick={() => create.mutate()} loading={create.isPending}>
              <Plus className="h-4 w-4" aria-hidden /> Add Customer
            </Button>
          </PermissionGate>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total" value={stats.data?.total} />
        <StatCard label="Active" value={stats.data?.active} tone="text-success" />
        <StatCard label="Inactive" value={stats.data?.inactive} />
        <StatCard label="High Risk" value={stats.data?.highRisk} tone="text-danger" />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div role="tablist" aria-label="Customer lists" className="flex border-b border-border">
          {tabBtn("all", "All Customers")}
          {tabBtn("drafts", `Partially Saved (${stats.data?.drafts ?? 0})`)}
        </div>
        <div className="space-y-3 p-4">
          <div className="relative max-w-xl">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
              aria-hidden
            />
            <Input
              aria-label="Search customers"
              className="pl-9"
              placeholder="Search name, mobile, Aadhaar, PAN, ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {tab === "all" && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filters">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  aria-pressed={filter === f.key}
                  onClick={() => (setFilter(f.key), setPage(1))}
                  className={cn(
                    "min-h-8 rounded-full border px-3 text-xs font-medium",
                    filter === f.key
                      ? "border-primary bg-primary text-fg-inverse"
                      : "border-border hover:bg-surface-muted",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <DataTable
          columns={columns}
          data={list.data?.items ?? []}
          loading={list.isLoading}
          sorting={sorting}
          onSortingChange={(s) => (setSorting(s), setPage(1))}
          page={page}
          pageSize={20}
          total={list.data?.total ?? 0}
          onPageChange={setPage}
          onRowClick={(c) => navigate(c.status === "DRAFT" ? `/customers/${c.id}/edit` : `/customers/${c.id}`)}
          emptyTitle={
            tab === "drafts"
              ? "No partially saved customers"
              : q
                ? "No customers match your search"
                : "No customers yet"
          }
          emptyDescription={tab === "all" && !q ? "Add your first customer to get started." : undefined}
        />
      </div>
      {importing && <ImportDialog open onOpenChange={setImporting} />}
    </div>
  );
}
