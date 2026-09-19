import { AlertTriangle, CheckCircle2, Circle, Clock, Info, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Colour is never the only signal: every tone carries an icon and a text label. */
const TONES = {
  success: { cls: "bg-success-soft text-success", Icon: CheckCircle2 },
  warning: { cls: "bg-warning-soft text-warning", Icon: Clock },
  danger: { cls: "bg-danger-soft text-danger", Icon: XCircle },
  info: { cls: "bg-info-soft text-info", Icon: Info },
  neutral: { cls: "bg-neutral-soft text-fg-muted", Icon: Circle },
  alert: { cls: "bg-danger-soft text-danger", Icon: AlertTriangle },
} as const satisfies Record<string, { cls: string; Icon: LucideIcon }>;

export type StatusTone = keyof typeof TONES;

/** Domain status -> tone. Extend as modules land (loan, chit, kyc...). */
export const STATUS_TONE: Record<string, StatusTone> = {
  ACTIVE: "success",
  PAID: "success",
  VERIFIED: "success",
  APPROVED: "success",
  COMPLETE: "success",
  PENDING: "warning",
  DUE: "warning",
  PARTIAL: "warning",
  UNDER_REVIEW: "warning",
  DRAFT: "neutral",
  INACTIVE: "neutral",
  NOT_STARTED: "neutral",
  OVERDUE: "danger",
  REJECTED: "danger",
  EXPIRED: "danger",
  SUSPENDED: "danger",
  SUBMITTED: "info",
  INVITED: "info",
  NEEDS_CHANGES: "alert",
};

const label = (s: string) =>
  s
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());

export function StatusBadge({
  status,
  tone,
  children,
  className,
}: {
  status?: string;
  tone?: StatusTone;
  children?: React.ReactNode;
  className?: string;
}) {
  const resolved: StatusTone = tone ?? (status ? STATUS_TONE[status] : undefined) ?? "neutral";
  const { cls, Icon } = TONES[resolved];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        cls,
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {children ?? (status ? label(status) : "")}
    </span>
  );
}
