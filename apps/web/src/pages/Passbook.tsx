import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Printer } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { PermissionGate } from "@/components/ui/permission-gate";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { PaymentDialog, ReceiptView } from "@/features/chits/PaymentDialog";
import type { Passbook as PassbookData, Receipt } from "@/features/chits/types";
import { inr } from "@/features/chits/ui";

const TONE: Record<string, StatusTone> = {
  PAID: "success",
  PARTIAL: "warning",
  DUE: "warning",
  OVERDUE: "danger",
  UPCOMING: "neutral",
};

/** A member's passbook for one ticket: every month, what they paid, dividends received and the prize. */
export default function Passbook() {
  const { ticketId = "" } = useParams();
  const [collect, setCollect] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["chit-passbook", ticketId],
    queryFn: () => api<PassbookData>(`/chits/tickets/${ticketId}/passbook`),
  });
  const receipt = useQuery({
    queryKey: ["chit-receipt", receiptId],
    queryFn: () => api<Receipt>(`/chits/payments/${receiptId}`),
    enabled: !!receiptId,
  });
  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  const p = q.data;
  if (!p)
    return (
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold">Passbook not found</h1>
      </div>
    );

  return (
    <div className="space-y-5">
      <Link
        to={`/chits/${p.group.id}?tab=members`}
        className="no-print inline-flex min-h-touch items-center gap-1 text-sm hover:underline md:min-h-0"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden /> Back to {p.group.name}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-surface p-5">
        <div>
          <h1 className="text-xl font-semibold">Passbook · ticket {p.ticket.number}</h1>
          <p className="text-sm">
            {p.customer ? (
              <Link to={`/customers/${p.customer.id}`} className="hover:underline">
                {p.customer.name} ({p.customer.code})
              </Link>
            ) : (
              "Vacant"
            )}
          </p>
          <p className="text-sm text-fg-muted">
            {p.group.name} · {p.group.code} · chit value {inr(p.group.chitValuePaise)}
          </p>
        </div>
        <div className="no-print flex gap-2">
          <PermissionGate permission="payment:create">
            {p.group.status === "RUNNING" && <Button onClick={() => setCollect(true)}>Collect payment</Button>}
          </PermissionGate>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden /> Print
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Paid so far", inr(p.totals.paidPaise)],
          ["Dividends received", inr(p.totals.dividendsReceivedPaise)],
          ["Outstanding", inr(p.totals.outstandingPaise)],
          ["Advance held", inr(p.totals.advancePaise)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs text-fg-muted">{k}</p>
            <p className="tabular mt-1 text-xl font-semibold">{v}</p>
          </div>
        ))}
      </div>

      {p.prize && (
        <div className="rounded-lg border border-success/40 bg-success-soft p-4 text-sm">
          <strong>Prize won in month {p.prize.month}:</strong>{" "}
          <span className="tabular">{inr(p.prize.prizePaise)}</span>
          {p.prize.setOffPaise > 0 && (
            <>
              {" "}
              · dues set off <span className="tabular">{inr(p.prize.setOffPaise)}</span> · net{" "}
              <span className="tabular">{inr(p.prize.netPaise)}</span>
            </>
          )}{" "}
          · payout {p.prize.status.toLowerCase()}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              {[
                "Month",
                "Auction",
                "Due date",
                ">Subscription",
                ">Dividend",
                ">To pay",
                ">Paid",
                ">Balance",
                "Status",
              ].map((h) => (
                <th key={h} scope="col" className={`px-4 py-3 font-medium ${h.startsWith(">") ? "text-right" : ""}`}>
                  {h.replace(">", "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {p.months.map((m) => (
              <tr key={m.month}>
                <td className="tabular px-4 py-2.5 font-medium">
                  {m.month}
                  {m.won && <span className="ml-1 text-xs text-success">★ won</span>}
                </td>
                <td className="tabular px-4 py-2.5 text-fg-muted">{m.auctionDate}</td>
                <td className="tabular px-4 py-2.5 text-fg-muted">{m.dueDate}</td>
                <td className="tabular px-4 py-2.5 text-right">{inr(m.basePaise)}</td>
                <td className="tabular px-4 py-2.5 text-right">
                  {m.netDuePaise === null ? "-" : inr(m.dividendPaise)}
                </td>
                <td className="tabular px-4 py-2.5 text-right">{inr(m.netDuePaise)}</td>
                <td className="tabular px-4 py-2.5 text-right">{inr(m.paidPaise)}</td>
                <td className="tabular px-4 py-2.5 text-right">{inr(m.outstandingPaise)}</td>
                <td className="px-4 py-2.5">
                  <StatusBadge tone={TONE[m.status] ?? "neutral"}>
                    {m.status.charAt(0) + m.status.slice(1).toLowerCase()}
                  </StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section>
        <h2 className="mb-2 font-semibold">Payments</h2>
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
          {p.payments.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span>
                <span className="tabular font-medium">{x.receiptNo}</span>{" "}
                <span className="tabular text-fg-muted">
                  · {x.paidOn} · {x.mode.replace("_", " ").toLowerCase()}
                </span>
              </span>
              <span className="flex items-center gap-3">
                {x.status === "REVERSED" && <StatusBadge tone="danger">Reversed</StatusBadge>}
                <span className="tabular">{inr(x.amountPaise, true)}</span>
                <button className="no-print text-primary hover:underline" onClick={() => setReceiptId(x.id)}>
                  Receipt
                </button>
              </span>
            </li>
          ))}
          {p.payments.length === 0 && <li className="px-4 py-6 text-center text-fg-muted">No payments yet.</li>}
        </ul>
      </section>

      {collect && <PaymentDialog ticketId={ticketId} onClose={() => setCollect(false)} />}
      <Modal open={!!receiptId} onOpenChange={(o) => !o && setReceiptId(null)} title="Receipt" wide>
        {receipt.data && <ReceiptView r={receipt.data} />}
      </Modal>
    </div>
  );
}
