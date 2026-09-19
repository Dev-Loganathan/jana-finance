import { forwardRef, useState } from "react";
import { formatINR } from "@jana/shared";
import { Input } from "@/components/ui/form";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { parseRupees } from "@/features/customers/wizard/useStepForm";
import type { ChitStatus } from "./types";

const STATUS: Record<ChitStatus, { tone: StatusTone; label: string }> = {
  DRAFT: { tone: "neutral", label: "Draft" },
  OPEN_FOR_ENROLMENT: { tone: "info", label: "Open for enrolment" },
  RUNNING: { tone: "success", label: "Running" },
  COMPLETED: { tone: "neutral", label: "Completed" },
  CANCELLED: { tone: "danger", label: "Cancelled" },
};

export const ChitStatusBadge = ({ status }: { status: ChitStatus }) => (
  <StatusBadge tone={STATUS[status].tone}>{STATUS[status].label}</StatusBadge>
);

export const inr = (paise: number | null | undefined, decimals = false) =>
  paise === null || paise === undefined ? "-" : formatINR(paise, { decimals: decimals || paise % 100 !== 0 });
export const pct = (bp: number) => `${bp / 100}%`;
export const TYPE_LABEL = { AUCTION: "Auction chit", LOTTERY: "Lottery / draw", FIXED: "Fixed order" } as const;

/** A rupee amount input. Emits paise (or undefined when blank/invalid) so callers never touch floating point. */
export const RupeeInput = forwardRef<
  HTMLInputElement,
  { id: string; onPaise: (p: number | undefined) => void; defaultRupees?: string } & Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "onChange" | "value" | "defaultValue"
  >
>(({ onPaise, defaultRupees = "", ...rest }, ref) => {
  const [text, setText] = useState(defaultRupees);
  return (
    <Input
      ref={ref}
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const p = parseRupees(e.target.value);
        onPaise(p === undefined || Number.isNaN(p) ? undefined : p);
      }}
      {...rest}
    />
  );
});
RupeeInput.displayName = "RupeeInput";

export const MODES = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CHEQUE", label: "Cheque" },
] as const;
