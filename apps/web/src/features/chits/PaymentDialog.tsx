import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Printer } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { useCan } from "@/auth/permissions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import type { Dues, Receipt } from "./types";
import { MODES, RupeeInput, inr } from "./ui";

const KIND: Record<string, string> = {
  INSTALLMENT: "Installment",
  PENALTY: "Late penalty",
  ADVANCE: "Advance (kept for later months)",
  ADVANCE_APPLIED: "Advance applied",
};

export function ReceiptView({ r }: { r: Receipt }) {
  const msg = `Receipt ${r.receiptNo}: Rs ${(r.amountPaise / 100).toLocaleString("en-IN")} received on ${r.paidOn} for ${r.group.name} (ticket ${r.ticket.number}). Thank you. - Jana Finance`;
  const phone = r.customer?.phone ? `91${r.customer.phone.replace(/\D/g, "").slice(-10)}` : "";
  return (
    <div className="space-y-4 text-sm" id="receipt">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <p className="text-lg font-semibold">Jana Finance</p>
          <p className="text-fg-muted">Payment receipt</p>
        </div>
        <div className="text-right">
          <p className="tabular font-semibold">{r.receiptNo}</p>
          <p className="tabular text-fg-muted">{r.paidOn}</p>
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
          <dt className="text-xs text-fg-muted">Chit group</dt>
          <dd>
            {r.group.name} · ticket {r.ticket.number}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">Mode</dt>
          <dd>
            {r.mode.replace("_", " ").toLowerCase()}
            {r.reference ? ` · ${r.reference}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">Amount</dt>
          <dd className="tabular text-lg font-semibold">{inr(r.amountPaise, true)}</dd>
        </div>
      </dl>
      <table className="w-full">
        <tbody className="divide-y divide-border">
          {r.allocations.map((a, i) => (
            <tr key={i}>
              <td className="py-1.5">
                {KIND[a.kind]}
                {a.month ? ` · month ${a.month}` : ""}
              </td>
              <td className="tabular py-1.5 text-right">{inr(a.amountPaise, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
 * Take a payment against a ticket. One Idempotency-Key is created when the dialog opens and reused on every retry,
 * so a double tap or a flaky connection can never record the payment twice.
 */
export function PaymentDialog({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const key = useRef(crypto.randomUUID());
  const [amount, setAmount] = useState<number | undefined>();
  const [typed, setTyped] = useState(false);
  const [mode, setMode] = useState("CASH");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const dues = useQuery({
    queryKey: ["chit-dues", ticketId, paidOn],
    queryFn: () => api<Dues>(`/chits/tickets/${ticketId}/dues`, { query: { asOf: paidOn || undefined } }),
  });
  const total = dues.data?.totalPayablePaise ?? 0;
  const value = typed ? amount : total || undefined;

  const pay = useMutation({
    mutationFn: () =>
      api<Receipt>(`/chits/tickets/${ticketId}/payments`, {
        method: "POST",
        body: { amountPaise: value, mode, reference: reference || undefined, paidOn: paidOn || undefined },
        idempotencyKey: key.current,
      }),
    onSuccess: (r) => {
      setReceipt(r);
      void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("chit") });
    },
    onError: (e) =>
      toast({
        tone: "danger",
        title: "Payment not recorded",
        description: e instanceof ApiError ? e.message : "Check your connection and try again. It is safe to retry.",
      }),
  });

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={receipt ? "Payment received" : "Collect payment"} wide>
      {receipt ? (
        <div className="space-y-4">
          <ReceiptView r={receipt} />
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : dues.isLoading || !dues.data ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            pay.mutate();
          }}
        >
          <div className="rounded-md bg-surface-muted p-3 text-sm">
            <p className="font-medium">
              {dues.data.customer?.name}{" "}
              <span className="text-fg-muted">
                · ticket {dues.data.ticket.number} · {dues.data.group.name}
              </span>
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-fg-muted">Installments due</dt>
                <dd className="tabular font-semibold">{inr(dues.data.outstandingPaise)}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Late penalty</dt>
                <dd className="tabular font-semibold">{inr(dues.data.penaltyPaise)}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Total payable</dt>
                <dd className="tabular font-semibold">{inr(total)}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Advance held</dt>
                <dd className="tabular font-semibold">{inr(dues.data.advancePaise)}</dd>
              </div>
            </dl>
            {dues.data.installments.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-fg-muted">
                {dues.data.installments.map((i) => (
                  <li key={i.id} className="tabular">
                    Month {i.month}: {inr(i.outstandingPaise)} due {i.dueDate}
                    {i.penaltyPaise > 0 ? ` + ${inr(i.penaltyPaise)} penalty` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Amount received (₹)"
              htmlFor="amt"
              required
              hint="Penalty is settled first, then the oldest dues; anything extra is kept as advance"
            >
              <RupeeInput
                key={String(total)}
                id="amt"
                defaultRupees={total ? String(total / 100) : ""}
                onPaise={(p) => {
                  setTyped(true);
                  setAmount(p);
                }}
                autoFocus
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
                  max={new Date().toISOString().slice(0, 10)}
                  value={paidOn}
                  onChange={(e) => setPaidOn(e.target.value)}
                />
              </Field>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="touch" loading={pay.isPending} disabled={!value}>
              Record {value ? inr(value, true) : "payment"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
