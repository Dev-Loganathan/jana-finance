import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, Download, FileSpreadsheet, Upload } from "lucide-react";
import { IMPORT_MAX_ROWS } from "@jana/shared";
import { ApiError, api, download, upload } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState, Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";

interface Report {
  batchId: string;
  fileName: string;
  expiresAt: string;
  total: number;
  ready: number;
  errors: number;
  duplicates: number;
  ignoredColumns: string[];
  status?: "VALIDATED" | "IMPORTING" | "IMPORTED" | "DISCARDED" | "EXPIRED";
  imported?: number;
  rows: {
    row: number;
    name: string;
    status: "ready" | "error" | "duplicate";
    errors: { column: string; header: string; message: string }[];
    duplicates: { code: string; name: string; reasons: string[] }[];
  }[];
}

interface Batch {
  id: string;
  fileName: string;
  status: string;
  total: number;
  ready: number;
  errors: number;
  duplicates: number;
  imported: number;
  createdAt: string;
  by: string;
  canImport: boolean;
  errorFileAvailable: boolean;
  duplicateFileAvailable: boolean;
}

type Tab = "errors" | "ready" | "duplicates";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="mb-3 flex items-center gap-3 font-semibold">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm text-fg-inverse">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function BulkImport() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [params, setParams] = useSearchParams();
  const batchId = params.get("batch");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [withDuplicates, setWithDuplicates] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    skippedErrors: number;
    skippedDuplicates: number;
    failed: number;
  } | null>(null);

  const batches = useQuery({ queryKey: ["import-batches"], queryFn: () => api<Batch[]>("/customers/import/batches") });
  const report = useQuery({
    queryKey: ["import-batch", batchId],
    queryFn: () => api<Report>(`/customers/import/batches/${batchId}`),
    enabled: !!batchId,
    retry: false,
  });
  const r = report.data;

  const check = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("file", file!);
      return upload<Report>("/customers/import/validate", form);
    },
    onSuccess: (rep) => {
      setFileError(null);
      setResult(null);
      setTab(null);
      setWithDuplicates(false);
      qc.setQueryData(["import-batch", rep.batchId], rep);
      void qc.invalidateQueries({ queryKey: ["import-batches"] });
      setParams({ batch: rep.batchId });
    },
    onError: (e) => setFileError(e instanceof ApiError ? e.message : "The file could not be checked. Try again."),
  });

  const run = useMutation({
    mutationFn: () =>
      api<{ imported: number; skippedErrors: number; skippedDuplicates: number; failed: number }>(
        `/customers/import/batches/${batchId}/run`,
        { method: "POST", body: { includeDuplicates: withDuplicates } },
      ),
    onSuccess: (x) => {
      setResult(x);
      setConfirm(false);
      void qc.invalidateQueries({ queryKey: ["customers"] });
      void qc.invalidateQueries({ queryKey: ["import-batches"] });
      void qc.invalidateQueries({ queryKey: ["import-batch", batchId] });
    },
    onError: (e) => {
      setConfirm(false);
      toast({ tone: "danger", title: "Import failed", description: e instanceof ApiError ? e.message : undefined });
    },
  });

  const discard = useMutation({
    mutationFn: (id: string) => api(`/customers/import/batches/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["import-batches"] });
      setParams({});
      setFile(null);
      toast({ tone: "success", title: "Upload discarded", description: "The data from that file has been removed." });
    },
  });

  const getFile = (path: string, query: Record<string, string>, name: string) =>
    download(path, query, name).catch((e) =>
      toast({ tone: "danger", title: "Download failed", description: e instanceof ApiError ? e.message : undefined }),
    );

  const imported = r?.status === "IMPORTED" || !!result;
  const active: Tab = tab ?? (r && r.errors > 0 ? "errors" : r && r.ready > 0 ? "ready" : "duplicates");
  const rows =
    r?.rows.filter((x) =>
      active === "errors" ? x.status === "error" : active === "ready" ? x.status === "ready" : x.status === "duplicate",
    ) ?? [];
  const remaining = r ? r.errors + r.duplicates : 0;
  const showReview = !!r && (!imported || remaining > 0);
  const importCount = r ? r.ready + (withDuplicates ? r.duplicates : 0) : 0;
  const tabBtn = (key: Tab, label: string, n: number, tone: string) => (
    <button
      role="tab"
      aria-selected={active === key}
      onClick={() => setTab(key)}
      className={cn(
        "min-h-touch rounded-md border px-4 text-sm font-medium md:min-h-10",
        active === key
          ? "border-primary bg-primary text-fg-inverse"
          : "border-border bg-surface hover:bg-surface-muted",
      )}
    >
      {label}{" "}
      <span className={cn("tabular ml-1 rounded-full px-2 py-0.5 text-xs", active === key ? "bg-white/20" : tone)}>
        {n}
      </span>
    </button>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link to="/customers" className="inline-flex min-h-touch items-center gap-1 text-sm hover:underline md:min-h-0">
        <ChevronLeft className="h-4 w-4" aria-hidden /> Back to Customers
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">Bulk upload customers</h1>
        <p className="text-fg-muted">Fill in the Excel template, upload it, fix any rows with problems, then import.</p>
      </div>

      <Step n={1} title="Download the template">
        <p className="mb-3 text-sm text-fg-muted">
          One customer per row, up to {IMPORT_MAX_ROWS} rows. Columns marked <strong>*</strong> are mandatory. The
          Instructions sheet explains every column. Photos and scanned documents are added later on each customer.
        </p>
        <Button
          variant="secondary"
          onClick={() => void getFile("/customers/import/template", {}, "jana-customer-import-template.xlsx")}
        >
          <Download className="h-4 w-4" aria-hidden /> Download Excel template
        </Button>
      </Step>

      <Step n={2} title="Upload your filled file">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={input}
            type="file"
            aria-label="Filled Excel file"
            accept=".xlsx,.csv"
            className="sr-only"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setFileError(null);
              e.target.value = "";
            }}
          />
          <Button variant="secondary" onClick={() => input.current?.click()}>
            <FileSpreadsheet className="h-4 w-4" aria-hidden />{" "}
            {file ? "Choose a different file" : "Choose file (.xlsx)"}
          </Button>
          {file && <span className="truncate text-sm">{file.name}</span>}
          <Button disabled={!file} loading={check.isPending} onClick={() => check.mutate()}>
            <Upload className="h-4 w-4" aria-hidden /> Check file
          </Button>
        </div>
        {fileError && (
          <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {fileError}
          </p>
        )}
        <p className="mt-2 text-xs text-fg-muted">
          Every row is checked first. Nothing is saved until you press Import.
        </p>
      </Step>

      {batchId && report.isLoading && <Skeleton className="h-48 w-full" />}
      {batchId && report.isError && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-3 text-sm text-danger">
          {report.error instanceof ApiError ? report.error.message : "This upload could not be opened."}{" "}
          <button className="underline" onClick={() => setParams({})}>
            Start again
          </button>
        </p>
      )}

      {r && (
        <Step n={3} title={imported ? "Result" : "Review"}>
          {r.ignoredColumns.length > 0 && (
            <p className="mb-3 text-xs text-fg-muted">Ignored columns: {r.ignoredColumns.join(", ")}</p>
          )}

          {imported && (
            <div className="mb-4 rounded-md border border-success/40 bg-success-soft p-4 text-sm">
              <p className="flex items-center gap-2 font-medium text-success">
                <CheckCircle2 className="h-4 w-4" aria-hidden /> {result?.imported ?? r.imported ?? 0} customer
                {(result?.imported ?? r.imported) === 1 ? "" : "s"} imported as drafts.
              </p>
              <p className="mt-1 text-fg-muted">
                They are complete but not active yet: record each customer's consent (open the draft, go to the last
                step, tick consent and create), and upload their documents.{" "}
                {result &&
                  (result.skippedErrors > 0 || result.skippedDuplicates > 0 || result.failed > 0) &&
                  `Not imported: ${result.skippedErrors + result.failed} with errors, ${result.skippedDuplicates} possible duplicates.`}
              </p>
              <Button className="mt-3" onClick={() => navigate("/customers")}>
                Go to Customers
              </Button>
            </div>
          )}

          {showReview && (
            <>
              <div className="flex flex-wrap gap-2" aria-live="polite">
                <StatusBadge tone="info">{r.total} rows</StatusBadge>
                {!imported && <StatusBadge tone="success">{r.ready} ready</StatusBadge>}
                {r.errors > 0 && <StatusBadge tone="danger">{r.errors} need fixing</StatusBadge>}
                {r.duplicates > 0 && <StatusBadge tone="warning">{r.duplicates} possible duplicates</StatusBadge>}
              </div>

              <div role="tablist" aria-label="Rows" className="mt-4 flex flex-wrap gap-2">
                {tabBtn("errors", "Need fixing", r.errors, "bg-danger-soft text-danger")}
                {!imported && tabBtn("ready", "Ready to import", r.ready, "bg-success-soft text-success")}
                {tabBtn("duplicates", "Possible duplicates", r.duplicates, "bg-warning-soft text-warning")}
              </div>

              <div className="mt-3 max-h-[26rem] overflow-auto rounded-md border border-border">
                {rows.length === 0 ? (
                  <EmptyState
                    title={
                      active === "errors"
                        ? "No rows with errors"
                        : active === "ready"
                          ? "No rows are ready"
                          : "No possible duplicates"
                    }
                  />
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface-muted text-left text-xs uppercase tracking-wide text-fg-muted">
                      <tr>
                        <th className="px-4 py-2 font-medium">Row</th>
                        <th className="px-4 py-2 font-medium">Customer</th>
                        <th className="px-4 py-2 font-medium">
                          {active === "errors" ? "What to fix" : active === "duplicates" ? "Matches" : ""}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((x) => (
                        <tr key={x.row} className="align-top">
                          <td className="tabular px-4 py-2">{x.row}</td>
                          <td className="px-4 py-2 font-medium">
                            {x.name || <span className="text-fg-muted">(no name)</span>}
                          </td>
                          <td className="px-4 py-2">
                            {x.errors.length > 0 && (
                              <ul className="space-y-0.5">
                                {x.errors.map((e) => (
                                  <li key={e.column}>
                                    <span className="font-medium">{e.header}:</span>{" "}
                                    <span className="text-danger">{e.message}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {x.duplicates.length > 0 && (
                              <ul className="space-y-0.5">
                                {x.duplicates.map((d, i) => (
                                  <li key={i}>
                                    {d.name} {d.code && <span className="text-fg-muted">({d.code})</span>}:{" "}
                                    <span className="text-warning">{d.reasons.join(", ")}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          <div className="mt-4 space-y-3">
            {r.errors > 0 && (
              <div className="rounded-md bg-surface-muted p-3 text-sm">
                <p>
                  Rows with errors are <strong>not imported</strong>. Download them, correct the highlighted cells, and
                  upload the corrected file (the Errors columns can stay).
                </p>
                <Button
                  className="mt-2"
                  variant="secondary"
                  onClick={() =>
                    void getFile(
                      `/customers/import/batches/${r.batchId}/errors`,
                      { rows: "errors" },
                      "customers-to-fix.xlsx",
                    )
                  }
                >
                  <Download className="h-4 w-4" aria-hidden /> Download {r.errors} row{r.errors === 1 ? "" : "s"} to fix
                </Button>
              </div>
            )}
            {r.duplicates > 0 && (
              <div className="rounded-md bg-surface-muted p-3 text-sm">
                <p>
                  These rows look like customers you already have (or repeat another row). They are skipped unless you
                  choose to import them.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void getFile(
                        `/customers/import/batches/${r.batchId}/errors`,
                        { rows: "duplicates" },
                        "possible-duplicates.xlsx",
                      )
                    }
                  >
                    <Download className="h-4 w-4" aria-hidden /> Download possible duplicates
                  </Button>
                  {!imported && (
                    <label className="flex min-h-touch items-center gap-2 md:min-h-0">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={withDuplicates}
                        onChange={(e) => setWithDuplicates(e.target.checked)}
                      />
                      Import the {r.duplicates} possible duplicate{r.duplicates === 1 ? "" : "s"} anyway
                    </label>
                  )}
                </div>
              </div>
            )}
            {!imported && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-fg-muted">
                  Held securely until {formatDateTime(r.expiresAt)}, then deleted.
                </p>
                <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
                  <Button variant="secondary" loading={discard.isPending} onClick={() => discard.mutate(r.batchId)}>
                    Discard this upload
                  </Button>
                  <Button
                    size="touch"
                    className="w-full sm:w-auto"
                    disabled={importCount === 0}
                    onClick={() => setConfirm(true)}
                  >
                    Import {importCount} customer{importCount === 1 ? "" : "s"} as drafts
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Step>
      )}

      <section className="rounded-lg border border-border bg-surface">
        <h2 className="border-b border-border px-5 py-3 font-semibold">Recent uploads</h2>
        {batches.isLoading ? (
          <Skeleton className="m-4 h-16" />
        ) : batches.data?.length ? (
          <ul className="divide-y divide-border text-sm">
            {batches.data.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{b.fileName}</p>
                  <p className="tabular text-xs text-fg-muted">
                    {formatDateTime(b.createdAt)} · {b.by} · {b.total} rows
                    {b.status === "IMPORTED" ? ` · ${b.imported} imported` : ""}
                    {b.errors > 0 ? ` · ${b.errors} with errors` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    tone={b.status === "IMPORTED" ? "success" : b.status === "VALIDATED" ? "info" : "neutral"}
                  >
                    {b.status.charAt(0) + b.status.slice(1).toLowerCase()}
                  </StatusBadge>
                  {b.canImport && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => (setResult(null), setTab(null), setParams({ batch: b.id }))}
                    >
                      Review
                    </Button>
                  )}
                  {b.errorFileAvailable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void getFile(
                          `/customers/import/batches/${b.id}/errors`,
                          { rows: "errors" },
                          "customers-to-fix.xlsx",
                        )
                      }
                    >
                      <Download className="h-4 w-4" aria-hidden /> Rows to fix
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No uploads yet"
            description="Uploads are listed here, and their data is deleted 24 hours after you upload."
          />
        )}
      </section>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Import these customers?"
        description={`${importCount} customer${importCount === 1 ? " is" : "s are"} created as drafts. ${r && r.errors > 0 ? `${r.errors} row${r.errors === 1 ? "" : "s"} with errors will not be imported.` : ""} Consent must still be recorded on each before they are active.`}
        subjectLabel="File"
        customer={r?.fileName}
        confirmLabel={`Import ${importCount}`}
        loading={run.isPending}
        onConfirm={() => run.mutate()}
      />
    </div>
  );
}
