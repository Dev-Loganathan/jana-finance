import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus, Search, Settings2 } from "lucide-react";
import type { Paged } from "@jana/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCan } from "@/auth/permissions";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/form";
import { PermissionGate } from "@/components/ui/permission-gate";
import { CollectDialog } from "@/features/loans/CollectDialog";
import type { InterestDueResult, LoanListItem, LoanStats, LoanStatus } from "@/features/loans/types";
import { DueBadge, LoanStatusBadge, Stat, fmtDate, inr, ratePct } from "@/features/loans/ui";

type Bucket = "overdue" | "today" | "week" | "all";
const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "week", label: "Next 7 days" },
  { key: "all", label: "All active" },
];
const STATUSES: { key: "" | LoanStatus; label: string }[] = [
  { key: "", label: "All" },
  { key: "APPLIED", label: "Waiting for approval" },
  { key: "APPROVED", label: "Approved" },
  { key: "ACTIVE", label: "Active" },
  { key: "CLOSED", label: "Closed" },
  { key: "REJECTED", label: "Rejected" },
];

function useDebounced(text: string) {
  const [v, setV] = useState(text);
  useEffect(() => {
    const t = setTimeout(() => setV(text), 300);
    return () => clearTimeout(t);
  }, [text]);
  return v;
}

function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="relative max-w-xl">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
        aria-hidden
      />
      <Input
        aria-label={label}
        className="pl-9"
        placeholder="Search name, mobile, customer ID or loan number…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "min-h-8 rounded-full border px-3 text-xs font-medium",
        active ? "border-primary bg-primary text-fg-inverse" : "border-border hover:bg-surface-muted",
      )}
    >
      {children}
    </button>
  );
}

const who = (l: LoanListItem) => (
  <div>
    <Link to={`/loans/${l.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
      {l.customer?.name ?? "Customer"}
    </Link>
    <div className="text-xs text-fg-muted">
      {l.code} · {ratePct(l.monthlyRateBp)} a month
      {l.customer?.phone ? ` · ${l.customer.phone}` : ""}
    </div>
  </div>
);

export default function Loans() {
  const navigate = useNavigate();
  const can = useCan();
  const [tab, setTab] = useState<"due" | "all">("due");
  const [bucket, setBucket] = useState<Bucket>("overdue");
  const [status, setStatus] = useState<"" | LoanStatus>("");
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [page, setPage] = useState(1);
  const [collecting, setCollecting] = useState<string | null>(null);

  const stats = useQuery({ queryKey: ["loans", "stats"], queryFn: () => api<LoanStats>("/loans/stats") });
  const due = useQuery({
    queryKey: ["interest-due", bucket, q, page],
    queryFn: () => api<InterestDueResult>("/loans/interest-due", { query: { bucket, q, page, pageSize: 20 } }),
    enabled: tab === "due",
    placeholderData: keepPreviousData,
  });
  const all = useQuery({
    queryKey: ["loans", "list", q, status, page],
    queryFn: () =>
      api<Paged<LoanListItem>>("/loans", { query: { q, status: status || undefined, page, pageSize: 20 } }),
    enabled: tab === "all",
    placeholderData: keepPreviousData,
  });

  const collectColumn = useMemo<ColumnDef<LoanListItem>>(
    () => ({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      cell: ({ row: { original: l } }) =>
        can("payment:create") && l.status === "ACTIVE" ? (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" onClick={() => setCollecting(l.id)}>
              Collect
            </Button>
          </div>
        ) : null,
    }),
    [can],
  );

  const dueColumns = useMemo<ColumnDef<LoanListItem>[]>(
    () => [
      { id: "who", header: "Customer", enableSorting: false, cell: ({ row: { original: l } }) => who(l) },
      {
        id: "principal",
        header: "Principal",
        enableSorting: false,
        meta: { align: "right" },
        cell: ({ row: { original: l } }) => <span className="tabular">{inr(l.principalOutstandingPaise)}</span>,
      },
      {
        id: "payable",
        header: "Interest to collect",
        enableSorting: false,
        meta: { align: "right" },
        cell: ({ row: { original: l } }) => (
          <div className="tabular">
            <span className="font-medium">{inr(l.interestDuePaise, true)}</span>
            {(l.interestPayablePaise ?? 0) > (l.interestDuePaise ?? 0) && (
              <div className="text-xs text-fg-muted">{inr(l.interestPayablePaise, true)} incl. this month so far</div>
            )}
          </div>
        ),
      },
      {
        id: "next",
        header: "Due date",
        enableSorting: false,
        cell: ({ row: { original: l } }) => (
          <div className="space-y-1">
            <div className="tabular text-fg-muted">{fmtDate(l.nextDueDate)}</div>
            <DueBadge overdueDays={l.overdueDays} dueToday={l.bucket === "today"} />
          </div>
        ),
      },
      collectColumn,
    ],
    [collectColumn],
  );

  const allColumns = useMemo<ColumnDef<LoanListItem>[]>(
    () => [
      { id: "who", header: "Customer", enableSorting: false, cell: ({ row: { original: l } }) => who(l) },
      {
        accessorKey: "productName",
        header: "Product",
        enableSorting: false,
        cell: ({ getValue }) => <span className="text-fg-muted">{getValue<string>()}</span>,
      },
      {
        id: "principal",
        header: "Loan amount",
        enableSorting: false,
        meta: { align: "right" },
        cell: ({ row: { original: l } }) => <span className="tabular">{inr(l.principalPaise)}</span>,
      },
      {
        id: "outstanding",
        header: "Outstanding",
        enableSorting: false,
        meta: { align: "right" },
        cell: ({ row: { original: l } }) => <span className="tabular">{inr(l.principalOutstandingPaise)}</span>,
      },
      {
        id: "since",
        header: "Paid out",
        enableSorting: false,
        cell: ({ row: { original: l } }) => <span className="tabular text-fg-muted">{fmtDate(l.disbursedOn)}</span>,
      },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row: { original: l } }) => (
          <div className="space-y-1">
            <LoanStatusBadge status={l.status} />
            <DueBadge overdueDays={l.status === "ACTIVE" ? l.overdueDays : 0} />
          </div>
        ),
      },
      collectColumn,
    ],
    [collectColumn],
  );

  const s = stats.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Loans</h1>
          <p className="text-fg-muted">Fixed monthly interest: collect it on time and see who is behind</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PermissionGate permission="loan:edit">
            <Button asChild variant="secondary">
              <Link to="/loans/products">
                <Settings2 className="h-4 w-4" aria-hidden /> Loan products
              </Link>
            </Button>
          </PermissionGate>
          <PermissionGate permission="loan:create">
            <Button asChild>
              <Link to="/loans/new">
                <Plus className="h-4 w-4" aria-hidden /> New Loan
              </Link>
            </Button>
          </PermissionGate>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Active loans"
          value={s?.active ?? "-"}
          hint={s ? `${s.applied} waiting for approval` : undefined}
        />
        <Stat label="Principal outstanding" value={s ? inr(s.principalOutstandingPaise) : "-"} />
        <Stat
          label="Interest overdue"
          value={s ? inr(s.interestOverduePaise) : "-"}
          tone={s && s.interestOverduePaise > 0 ? "text-danger" : undefined}
          hint={s ? `${s.overdueLoans} ${s.overdueLoans === 1 ? "loan" : "loans"} behind` : undefined}
        />
        <Stat label="Interest due now" value={s ? inr(s.interestDuePaise) : "-"} />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div role="tablist" aria-label="Loan lists" className="flex border-b border-border">
          {(
            [
              ["due", "Interest to collect"],
              ["all", "All loans"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => (setTab(k), setPage(1))}
              className={cn(
                "min-h-touch px-5 text-sm font-medium md:min-h-11",
                tab === k ? "bg-primary text-fg-inverse" : "text-fg-muted hover:bg-surface-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="space-y-3 p-4">
          <SearchBox
            value={search}
            onChange={(v) => (setSearch(v), setPage(1))}
            label={tab === "due" ? "Search loans to collect" : "Search loans"}
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filters">
            {tab === "due"
              ? BUCKETS.map((b) => {
                  const n = b.key === "all" ? undefined : due.data?.counts[b.key];
                  return (
                    <Chip key={b.key} active={bucket === b.key} onClick={() => (setBucket(b.key), setPage(1))}>
                      {b.label}
                      {n !== undefined ? ` (${n})` : ""}
                    </Chip>
                  );
                })
              : STATUSES.map((f) => (
                  <Chip key={f.key} active={status === f.key} onClick={() => (setStatus(f.key), setPage(1))}>
                    {f.label}
                  </Chip>
                ))}
          </div>
          {tab === "due" && due.data && due.data.total > 0 && (
            <p className="text-sm text-fg-muted">
              {due.data.total} {due.data.total === 1 ? "loan" : "loans"} ·{" "}
              <span className="tabular font-medium text-fg">{inr(due.data.totals.interestDuePaise)}</span> interest due
              {due.data.totals.interestOverduePaise > 0 && (
                <>
                  , of which{" "}
                  <span className="tabular font-medium text-danger">{inr(due.data.totals.interestOverduePaise)}</span>{" "}
                  is overdue
                </>
              )}
            </p>
          )}
        </div>
        {tab === "due" ? (
          <DataTable
            columns={dueColumns}
            data={due.data?.items ?? []}
            loading={due.isLoading}
            page={page}
            pageSize={20}
            total={due.data?.total ?? 0}
            onPageChange={setPage}
            onRowClick={(l) => navigate(`/loans/${l.id}`)}
            emptyTitle={bucket === "overdue" ? "Nobody is behind on interest" : "Nothing to collect here"}
            emptyDescription={bucket === "overdue" ? "Every finished month has been paid." : undefined}
          />
        ) : (
          <DataTable
            columns={allColumns}
            data={all.data?.items ?? []}
            loading={all.isLoading}
            page={page}
            pageSize={20}
            total={all.data?.total ?? 0}
            onPageChange={setPage}
            onRowClick={(l) => navigate(`/loans/${l.id}`)}
            emptyTitle={q || status ? "No loans match" : "No loans yet"}
            emptyDescription={!q && !status && can("loan:create") ? "Start with New Loan." : undefined}
          />
        )}
      </div>
      {collecting && <CollectDialog loanId={collecting} onClose={() => setCollecting(null)} />}
    </div>
  );
}
