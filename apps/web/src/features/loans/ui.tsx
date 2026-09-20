import { formatINR } from "@jana/shared";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { LoanStatus } from "./types";

const STATUS: Record<LoanStatus, { tone: StatusTone; label: string }> = {
  APPLIED: { tone: "info", label: "Waiting for approval" },
  APPROVED: { tone: "warning", label: "Approved, not paid out" },
  ACTIVE: { tone: "success", label: "Active" },
  CLOSED: { tone: "neutral", label: "Closed" },
  REJECTED: { tone: "danger", label: "Rejected" },
  CANCELLED: { tone: "neutral", label: "Cancelled" },
};

export const LoanStatusBadge = ({ status }: { status: LoanStatus }) => (
  <StatusBadge tone={STATUS[status].tone}>{STATUS[status].label}</StatusBadge>
);

export const inr = (paise: number | null | undefined, decimals = false) =>
  paise === null || paise === undefined ? "-" : formatINR(paise, { decimals: decimals || paise % 100 !== 0 });

/** 200 basis points -> "2%". */
export const ratePct = (bp: number) => `${bp / 100}%`;

export function fmtDate(d: string | null | undefined) {
  if (!d) return "-";
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** How late a payment is, as a badge that carries text and an icon, never colour alone. */
export function DueBadge({ overdueDays, dueToday }: { overdueDays: number; dueToday?: boolean }) {
  if (overdueDays > 0) return <StatusBadge tone="danger">{overdueDays} days overdue</StatusBadge>;
  if (dueToday) return <StatusBadge tone="warning">Due today</StatusBadge>;
  return null;
}

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-border bg-surface p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className={`tabular mt-1 text-2xl font-semibold ${tone ?? ""}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>}
    </div>
  );
}

/** A rate typed as a percentage per month ("2" or "1.5"), reported in basis points. */
export function parseRatePct(text: string): number | undefined {
  if (!/^\d+(\.\d{1,2})?$/.test(text.trim())) return undefined;
  return Math.round(Number(text) * 100);
}
