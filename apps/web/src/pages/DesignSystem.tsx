import { useMemo, useState } from "react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { MoneyText } from "@/components/ui/money-text";
import { Stepper } from "@/components/ui/stepper";
import { FileUploader } from "@/components/ui/file-uploader";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PermissionGate } from "@/components/ui/permission-gate";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState, Skeleton } from "@/components/ui/skeleton";

interface Row {
  id: string;
  name: string;
  city: string;
  status: string;
  balance: number;
}

const ROWS: Row[] = [
  { id: "CUS1006", name: "Loganathan P", city: "Kanchipuram", status: "ACTIVE", balance: 10000000 },
  { id: "CUS1005", name: "Kananan Admin", city: "Kanchipuram", status: "OVERDUE", balance: 4550075 },
  { id: "CUS1004", name: "Jana", city: "Chennai", status: "PENDING", balance: -12500 },
  { id: "CUS1003", name: "Jayaram N P", city: "Kanchipuram", status: "VERIFIED", balance: 0 },
];

const STEPS = [
  { key: "basic", label: "Basic Details" },
  { key: "address", label: "Address" },
  { key: "kyc", label: "KYC & Documents" },
  { key: "employment", label: "Employment" },
  { key: "references", label: "References" },
  { key: "evaluation", label: "Evaluation" },
];

const TONES: StatusTone[] = ["success", "warning", "danger", "info", "neutral", "alert"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="rounded-lg border border-border bg-surface p-4">{children}</div>
    </section>
  );
}

export default function DesignSystem() {
  const [step, setStep] = useState(2);
  const [files, setFiles] = useState<File[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [loading, setLoading] = useState(false);

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Customer",
        cell: (c) => (
          <div>
            <div className="font-medium">{c.row.original.name}</div>
            <div className="text-xs text-fg-muted">{c.row.original.id}</div>
          </div>
        ),
      },
      { accessorKey: "city", header: "City" },
      { accessorKey: "status", header: "Status", cell: (c) => <StatusBadge status={c.getValue<string>()} /> },
      {
        accessorKey: "balance",
        header: "Balance",
        meta: { align: "right" },
        cell: (c) => <MoneyText paise={c.getValue<number>()} />,
      },
    ],
    [],
  );

  const sorted = useMemo(() => {
    const s = sorting[0];
    if (!s) return ROWS;
    const dir = s.desc ? -1 : 1;
    return [...ROWS].sort((a, b) => (a[s.id as keyof Row] > b[s.id as keyof Row] ? dir : -dir));
  }, [sorting]);

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold">Design system</h1>
        <p className="text-fg-muted">
          Jana Finance component library. Tokens live in <code>src/theme/tokens.css</code>.
        </p>
      </header>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>
            <Plus className="h-4 w-4" aria-hidden />
            Add customer
          </Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Reverse payment</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button size="touch">Collect payment (touch)</Button>
        </div>
      </Section>

      <Section title="Status badges (colour + icon + text)">
        <div className="flex flex-wrap gap-2">
          {TONES.map((t) => (
            <StatusBadge key={t} tone={t}>
              {t}
            </StatusBadge>
          ))}
          {["ACTIVE", "OVERDUE", "NEEDS_CHANGES", "UNDER_REVIEW", "REJECTED"].map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
      </Section>

      <Section title="Money (paise in, Indian grouping, tabular)">
        <div className="w-64 space-y-1">
          {[10000000, 4550075, 99, 0, -12500].map((p) => (
            <div key={p} className="flex justify-between border-b border-border py-1">
              <span className="text-fg-muted">{p} paise</span>
              <MoneyText paise={p} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Stepper">
        <Stepper
          steps={STEPS}
          current={step}
          completed={STEPS.slice(0, step).map((s) => s.key)}
          onStepClick={setStep}
        />
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))}>
            Back
          </Button>
          <Button size="sm" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
            Next
          </Button>
        </div>
      </Section>

      <Section title="Data table (sortable, loading, empty)">
        <div className="space-y-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1200);
            }}
          >
            Simulate loading
          </Button>
          <DataTable
            columns={columns}
            data={sorted}
            loading={loading}
            sorting={sorting}
            onSortingChange={setSorting}
            page={1}
            pageSize={10}
            total={ROWS.length}
            onPageChange={() => {}}
            onRowClick={() => {}}
          />
          <DataTable
            columns={columns}
            data={[]}
            emptyTitle="No customers found"
            emptyDescription="Try a different search or add a new customer."
          />
        </div>
      </Section>

      <Section title="File uploader">
        <div className="max-w-md">
          <FileUploader
            label="Aadhaar front"
            value={files}
            onChange={setFiles}
            accept="image/*,application/pdf"
            maxSizeMB={5}
          />
        </div>
      </Section>

      <Section title="Confirm dialog (shows amount + customer)">
        <Button variant="danger" onClick={() => setConfirm(true)}>
          Reverse payment
        </Button>
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title="Reverse this payment?"
          amountPaise={4550075}
          customer="Kananan Admin (CUS1005)"
          confirmLabel="Reverse payment"
          destructive
          onConfirm={() => setConfirm(false)}
        />
      </Section>

      <Section title="Permission gate (no permissions granted in this demo)">
        <PermissionGate
          permission="customer:delete"
          fallback={<p className="text-sm text-fg-muted">Hidden: you lack customer:delete.</p>}
        >
          <Button variant="danger">Delete customer</Button>
        </PermissionGate>
      </Section>

      <Section title="Skeleton and empty state">
        <div className="space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <EmptyState title="No follow-ups today" description="Scheduled follow-ups will appear here." />
      </Section>
    </main>
  );
}
