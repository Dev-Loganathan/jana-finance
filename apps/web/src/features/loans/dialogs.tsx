import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { useCan } from "@/auth/permissions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { MODES } from "@/features/chits/ui";
import { ReceiptView } from "./CollectDialog";
import type { LoanDetail, LoanReceipt } from "./types";
import { fmtDate, inr } from "./ui";
import { Skeleton } from "@/components/ui/skeleton";

/** Everything that shows a loan or money must refresh after a change. */
export function useRefreshLoans() {
  const qc = useQueryClient();
  return () =>
    qc.invalidateQueries({
      predicate: (q) => ["loan", "loans", "interest-due", "dashboard", "loan-preview"].includes(String(q.queryKey[0])),
    });
}

function useAction<T>(loanId: string, path: string, done: string, onClose: () => void) {
  const toast = useToast();
  const refresh = useRefreshLoans();
  return useMutation({
    mutationFn: (body: object) => api<T>(`/loans/${loanId}/${path}`, { method: "POST", body }),
    onSuccess: () => (void refresh(), toast({ tone: "success", title: done }), onClose()),
    onError: (e) =>
      toast({ tone: "danger", title: "Not done", description: e instanceof ApiError ? e.message : undefined }),
  });
}

export function ApproveDialog({ loan, onClose }: { loan: LoanDetail; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const approve = useAction(loan.id, "approve", "Loan approved", onClose);
  const needs = loan.warnings.length > 0;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Approve ${loan.code}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          approve.mutate({ overrideReason: needs ? reason : undefined });
        }}
      >
        <p className="text-sm">
          Lend <span className="tabular font-semibold">{inr(loan.principalPaise, true)}</span> to{" "}
          <span className="font-semibold">{loan.customer?.name}</span> at {loan.monthlyRateBp / 100}% a month.
        </p>
        {needs && (
          <div className="rounded-md bg-warning-soft p-3 text-sm text-warning">
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" aria-hidden /> Warnings on this application
            </p>
            <ul className="mt-1 list-disc pl-6">
              {loan.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {needs && (
          <Field label="Why approve it anyway?" htmlFor="why" required hint="Kept with the loan and in the audit log">
            <Textarea
              id="why"
              rows={3}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
          </Field>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={approve.isPending} disabled={needs && reason.trim().length < 3}>
            Approve
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Asks for a reason, then does something. Used to reject an application and to reverse a receipt. */
export function ReasonDialog({
  title,
  intro,
  confirmLabel,
  onSubmit,
  loading,
  onClose,
}: {
  title: string;
  intro?: string;
  confirmLabel: string;
  onSubmit: (reason: string) => void;
  loading: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(reason.trim());
        }}
      >
        {intro && <p className="text-sm text-fg-muted">{intro}</p>}
        <Field label="Reason" htmlFor="reason" required>
          <Textarea
            id="reason"
            rows={3}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={loading} disabled={reason.trim().length < 3}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function RejectDialog({ loan, onClose }: { loan: LoanDetail; onClose: () => void }) {
  const reject = useAction(loan.id, "reject", "Application rejected", onClose);
  return (
    <ReasonDialog
      title={`Reject ${loan.code}`}
      intro="The customer's application is closed. The reason is kept on the loan."
      confirmLabel="Reject"
      loading={reject.isPending}
      onSubmit={(reason) => reject.mutate({ reason })}
      onClose={onClose}
    />
  );
}

export function DisburseDialog({ loan, onClose }: { loan: LoanDetail; onClose: () => void }) {
  const can = useCan();
  const [mode, setMode] = useState("CASH");
  const [reference, setReference] = useState("");
  const [on, setOn] = useState("");
  const go = useAction(loan.id, "disburse", "Loan paid out", onClose);
  const net = loan.principalPaise - loan.processingFeePaise;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Pay out ${loan.code}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          go.mutate({ mode, reference: reference || undefined, disbursedOn: on || undefined });
        }}
      >
        <dl className="space-y-1 rounded-md bg-surface-muted p-3 text-sm">
          <div className="flex justify-between">
            <dt>Loan amount</dt>
            <dd className="tabular">{inr(loan.principalPaise, true)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Processing fee</dt>
            <dd className="tabular">− {inr(loan.processingFeePaise, true)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-1 font-semibold">
            <dt>Hand over to {loan.customer?.name}</dt>
            <dd className="tabular">{inr(net, true)}</dd>
          </div>
        </dl>
        <p className="text-xs text-fg-muted">
          Interest starts from the payout date and is due every month on the same day.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Paid by" htmlFor="dmode">
            <Select id="dmode" value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          {mode !== "CASH" && (
            <Field label="Reference (UTR / cheque no.)" htmlFor="dref">
              <Input id="dref" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />
            </Field>
          )}
          {can("payment:backdate") && (
            <Field
              label="Payout date"
              htmlFor="don"
              hint="Leave blank for today. Use an earlier date only when entering a loan that was already given."
            >
              <Input
                id="don"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={on}
                onChange={(e) => setOn(e.target.value)}
              />
            </Field>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="touch" loading={go.isPending}>
            Pay out {inr(net, true)}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ReceiptModal({ paymentId, onClose }: { paymentId: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["loan", "receipt", paymentId],
    queryFn: () => api<LoanReceipt>(`/loans/payments/${paymentId}`),
  });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Receipt" wide>
      {q.data ? <ReceiptView r={q.data} /> : <Skeleton className="h-40 w-full" />}
    </Modal>
  );
}

export const loanDate = fmtDate;
