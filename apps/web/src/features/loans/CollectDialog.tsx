import { useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Printer } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { useCan } from "@/auth/permissions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { MODES, RupeeInput } from "@/features/chits/ui";
import type { LoanDetail, LoanReceipt } from "./types";
import { fmtDate, inr } from "./ui";

export function ReceiptView({ r }: { r: LoanReceipt }) {
  const msg = `Receipt ${r.receiptNo}: Rs ${(r.amountPaise / 100).toLocaleString("en-IN")} received on ${fmtDate(r.paidOn)} for loan ${r.loan.code}. Thank you. - Jana Finance`;
  const phone = r.customer?.phone ? `91${r.customer.phone.replace(/\D/g, "").slice(-10)}` : "";
  return (
    <div className="space-y-4 text-sm" id="receipt">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <p className="text-lg font-semibold">Jana Finance</p>
          <p className="text-fg-muted">Loan payment receipt</p>
        </div>
        <div className="text-right">
          <p className="tabular font-semibold">{r.receiptNo}</p>
          <p className="text-fg-muted">{fmtDate(r.paidOn)}</p>
          {r.status === "REVERSED" && <p className="font-semibold text-danger">REVERSED</p>}
        </div>
      </div>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-fg-muted">Received from</dt>
          <dd>
            {r.customer?.name} {r.customer && <span className="text-fg-muted">({r.customer.code})</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">Loan</dt>
          <dd>{r.loan.code}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">Mode</dt>
          <dd>
            {r.mode.replace("_", " ").toLowerCase()}
            {r.reference ? ` · ${r.reference}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">Amount received</dt>
          <dd className="tabular text-lg font-semibold">{inr(r.amountPaise, true)}</dd>
        </div>
      </dl>
      <table className="w-full">
        <tbody className="divide-y divide-border">
          {r.interestFor.map((i) => (
            <tr key={i.month}>
              <td className="py-1.5">
                Interest, month {i.month}
                {i.dueDate ? <span className="text-fg-muted"> (due {fmtDate(i.dueDate)})</span> : null}
              </td>
              <td className="tabular py-1.5 text-right">{inr(i.amountPaise, true)}</td>
            </tr>
          ))}
          {r.principalPaise > 0 && (
            <tr>
              <td className="py-1.5">Principal repaid</td>
              <td className="tabular py-1.5 text-right">{inr(r.principalPaise, true)}</td>
            </tr>
          )}
        </tbody>
      </table>
      {r.principalOutstandingAfterPaise !== null && (
        <p className="text-fg-muted">
          Principal outstanding after this payment:{" "}
          <span className="tabular font-medium text-fg">{inr(r.principalOutstandingAfterPaise, true)}</span>
          {r.loan.status === "CLOSED" && " · this loan is now closed"}
        </p>
      )}
      {r.status === "REVERSED" && r.reversalReason && <p className="text-danger">Reversed: {r.reversalReason}</p>}
      <div className="no-print flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer className="h-4 w-4" aria-hidden /> Print
        </Button>
        {phone && (
          <Button asChild variant="secondary">
            <a href={`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer">
              <MessageCircle className="h-4 w-4" aria-hidden /> Send on WhatsApp
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Collect interest and/or principal in one receipt. One Idempotency-Key is made when the dialog opens and reused on
 * every retry, so a double tap or a flaky connection can never take the same payment twice.
 */
export function CollectDialog({
  loanId,
  startWith = "due",
  onClose,
}: {
  loanId: string;
  /** "due" fills the interest now due; "payoff" fills everything needed to close the loan. */
  startWith?: "due" | "payoff";
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const key = useRef(crypto.randomUUID());
  /** What the collector has typed or filled in. It applies only to the figures (date) it was entered against. */
  const [entered, setEntered] = useState<{ asOf: string; i: number; p: number; v: number } | null>(null);
  const [mode, setMode] = useState("CASH");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [receipt, setReceipt] = useState<LoanReceipt | null>(null);

  const q = useQuery({
    queryKey: ["loan", loanId, paidOn || "today"],
    queryFn: () => api<LoanDetail>(`/loans/${loanId}`, { query: { asOf: paidOn || undefined } }),
    placeholderData: keepPreviousData,
  });
  const loan = q.data;
  const pos = loan?.position;

  // Until the collector changes something, the amounts are simply the figures for the chosen date.
  const asOf = loan?.asOf ?? "";
  const start = {
    i: pos ? (startWith === "payoff" ? pos.interestPayablePaise : pos.interestDuePaise) : 0,
    p: pos && startWith === "payoff" ? pos.principalOutstandingPaise : 0,
  };
  const cur = entered && entered.asOf === asOf ? entered : { asOf, ...start, v: 0 };
  const i = cur.i;
  const p = cur.p;
  const problem =
    !pos || i + p <= 0
      ? "Enter an amount"
      : i > pos.interestPayablePaise
        ? `Interest cannot be more than ${inr(pos.interestPayablePaise, true)}`
        : p > pos.principalOutstandingPaise
          ? `Principal cannot be more than ${inr(pos.principalOutstandingPaise, true)}`
          : null;

  const pay = useMutation({
    mutationFn: () =>
      api<LoanReceipt>(`/loans/${loanId}/payments`, {
        method: "POST",
        body: {
          interestPaise: i,
          principalPaise: p,
          mode,
          reference: reference || undefined,
          paidOn: paidOn || undefined,
        },
        idempotencyKey: key.current,
      }),
    onSuccess: (r) => {
      setReceipt(r);
      void qc.invalidateQueries({
        predicate: (x) => ["loan", "loans", "dashboard", "interest-due"].includes(String(x.queryKey[0])),
      });
    },
    onError: (e) =>
      toast({
        tone: "danger",
        title: "Payment not recorded",
        description: e instanceof ApiError ? e.message : "Check your connection and try again. It is safe to retry.",
      }),
  });

  const fill = (interestPaise: number, principalPaise: number) =>
    setEntered({ asOf, i: interestPaise, p: principalPaise, v: cur.v + 1 });

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={receipt ? "Payment received" : "Collect payment"} wide>
      {receipt ? (
        <div className="space-y-4">
          <ReceiptView r={receipt} />
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : q.isLoading || !loan || !pos ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!problem) pay.mutate();
          }}
        >
          <div className="rounded-md bg-surface-muted p-3 text-sm">
            <p className="font-medium">
              {loan.customer?.name} <span className="text-fg-muted">· {loan.code}</span>
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-fg-muted">Principal outstanding</dt>
                <dd className="tabular font-semibold">{inr(pos.principalOutstandingPaise)}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Interest due now</dt>
                <dd className="tabular font-semibold">{inr(pos.interestDuePaise)}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Building this month</dt>
                <dd className="tabular font-semibold">{inr(pos.interestAccruingPaise)}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">To close the loan</dt>
                <dd className="tabular font-semibold">{inr(pos.payoffPaise)}</dd>
              </div>
            </dl>
            {pos.cycles.some((c) => c.outstandingPaise > 0) && (
              <ul className="mt-2 space-y-0.5 text-xs text-fg-muted">
                {pos.cycles
                  .filter((c) => c.outstandingPaise > 0)
                  .map((c) => (
                    <li key={c.seq} className="tabular">
                      Month {c.seq}: {inr(c.outstandingPaise, true)}{" "}
                      {c.complete ? `due ${fmtDate(c.dueDate)}` : "so far, not yet due"}
                      {c.overdueDays > 0 ? ` (${c.overdueDays} days overdue)` : ""}
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => fill(pos.interestDuePaise, 0)}>
              Interest due
            </Button>
            <Button type="button" variant="secondary" onClick={() => fill(pos.interestPayablePaise, 0)}>
              All interest so far
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => fill(pos.interestPayablePaise, pos.principalOutstandingPaise)}
            >
              Pay off in full
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Interest received (₹)" htmlFor="int" hint="Oldest month is settled first">
              <RupeeInput
                key={`${asOf}-i${cur.v}`}
                id="int"
                defaultRupees={i ? String(i / 100) : ""}
                onPaise={(v) => setEntered({ ...cur, i: v ?? 0 })}
                autoFocus
              />
            </Field>
            <Field
              label="Principal repaid (₹)"
              htmlFor="prin"
              hint="Optional. Interest is then charged on the lower balance."
            >
              <RupeeInput
                key={`${asOf}-p${cur.v}`}
                id="prin"
                defaultRupees={p ? String(p / 100) : ""}
                onPaise={(v) => setEntered({ ...cur, p: v ?? 0 })}
              />
            </Field>
            <Field label="Mode" htmlFor="mode">
              <Select id="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                {MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            {mode !== "CASH" && (
              <Field label="Reference (UTR / cheque no.)" htmlFor="ref">
                <Input id="ref" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />
              </Field>
            )}
            {can("payment:backdate") && (
              <Field
                label="Payment date"
                htmlFor="paidOn"
                hint="Leave blank for today. An earlier date is a back-dated entry (audited)."
              >
                <Input
                  id="paidOn"
                  type="date"
                  min={loan.disbursedOn ?? undefined}
                  max={new Date().toISOString().slice(0, 10)}
                  value={paidOn}
                  onChange={(e) => setPaidOn(e.target.value)}
                />
              </Field>
            )}
          </div>

          {problem && i + p > 0 && (
            <p role="alert" className="text-sm text-danger">
              {problem}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="touch" loading={pay.isPending} disabled={!!problem}>
              Record {i + p > 0 ? inr(i + p, true) : "payment"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
