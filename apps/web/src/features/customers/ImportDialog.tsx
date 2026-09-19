import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, FileUp } from "lucide-react";
import { ApiError, download, upload } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";

interface Report {
  dryRun: boolean;
  total: number;
  ok: number;
  duplicates: number;
  errors: number;
  created: number;
  ignoredColumns: string[];
  rows: { row: number; name: string; status: "ok" | "duplicate" | "error"; messages: string[] }[];
}

/**
 * Two-step CSV import: first "Check file" (a dry run that saves nothing and reports every problem row),
 * then "Import" to create the valid rows as drafts. Drafts still need consent, references and bank details.
 */
export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  const run = useMutation({
    mutationFn: (dryRun: boolean) => {
      const form = new FormData();
      form.append("dryRun", String(dryRun));
      form.append("file", file!);
      return upload<Report>("/customers/import", form);
    },
    onSuccess: (r) => {
      setReport(r);
      if (!r.dryRun) {
        void qc.invalidateQueries({ queryKey: ["customers"] });
        toast({
          tone: "success",
          title: `Imported ${r.created} customer${r.created === 1 ? "" : "s"} as drafts`,
          description: "Open Partially Saved to finish them.",
        });
      }
    },
    onError: (e) =>
      toast({ tone: "danger", title: "Import failed", description: e instanceof ApiError ? e.message : undefined }),
  });

  const problems = report?.rows.filter((r) => r.status !== "ok") ?? [];
  const imported = report && !report.dryRun;

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setFile(null);
          setReport(null);
        }
        onOpenChange(o);
      }}
      title="Import customers from CSV"
      wide
    >
      <div className="space-y-4 text-sm">
        <p className="text-fg-muted">
          Customers are imported as <strong>drafts</strong>: they still need the customer's consent, references and bank
          details before they become active.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void download("/customers/import/template", {}, "customer-import-template.csv")}
        >
          <Download className="h-4 w-4" aria-hidden /> Download template
        </Button>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            className="sr-only"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setReport(null);
            }}
          />
          <Button variant="secondary" onClick={() => input.current?.click()}>
            <FileUp className="h-4 w-4" aria-hidden /> {file ? "Choose a different file" : "Choose CSV file"}
          </Button>
          {file && <span className="truncate">{file.name}</span>}
        </div>

        {report && (
          <div className="space-y-3" aria-live="polite">
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="info">{report.total} rows</StatusBadge>
              <StatusBadge tone="success">{report.ok} ready</StatusBadge>
              {report.duplicates > 0 && (
                <StatusBadge tone="warning">{report.duplicates} duplicates skipped</StatusBadge>
              )}
              {report.errors > 0 && <StatusBadge tone="danger">{report.errors} with errors</StatusBadge>}
            </div>
            {report.ignoredColumns.length > 0 && (
              <p className="text-xs text-fg-muted">Ignored columns: {report.ignoredColumns.join(", ")}</p>
            )}
            {problems.length > 0 && (
              <div className="max-h-64 overflow-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-surface-muted text-left">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Problem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {problems.map((r) => (
                      <tr key={r.row}>
                        <td className="tabular px-3 py-2">{r.row}</td>
                        <td className="px-3 py-2">{r.name || "-"}</td>
                        <td className="px-3 py-2">
                          <StatusBadge tone={r.status === "duplicate" ? "warning" : "danger"}>{r.status}</StatusBadge>
                          <ul className="mt-1 list-disc pl-4">
                            {r.messages.map((m, i) => (
                              <li key={i}>{m}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {imported && (
              <p className="flex items-center gap-2 font-medium text-success">
                <CheckCircle2 className="h-4 w-4" aria-hidden /> {report.created} customer
                {report.created === 1 ? "" : "s"} imported as drafts.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {imported ? "Close" : "Cancel"}
          </Button>
          {!imported && (
            <>
              <Button
                variant="secondary"
                disabled={!file}
                loading={run.isPending && run.variables === true}
                onClick={() => run.mutate(true)}
              >
                Check file
              </Button>
              <Button
                disabled={!file || !report || report.ok === 0}
                loading={run.isPending && run.variables === false}
                onClick={() => run.mutate(false)}
              >
                Import {report?.ok ? `${report.ok} customer${report.ok === 1 ? "" : "s"}` : ""}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
