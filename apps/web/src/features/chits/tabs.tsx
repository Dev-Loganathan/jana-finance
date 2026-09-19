import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Gavel, Printer, UserMinus, UserPlus, Repeat } from "lucide-react";
import { computeAuction } from "@jana/shared";
import { ApiError, api } from "@/lib/api";
import { useCan } from "@/auth/permissions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { PermissionGate } from "@/components/ui/permission-gate";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";
import type { CustomerListItem } from "@/features/customers/types";
import { CustomerPicker } from "./CustomerPicker";
import { PaymentDialog } from "./PaymentDialog";
import type { ChitGroupDetail, CollectionRow, CycleDetail, Payout, Statement } from "./types";
import { MODES, RupeeInput, inr, pct } from "./ui";

/** Refresh everything chit-related after any change. */
export function useRefreshChits() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("chit") });
}

const errText = (e: unknown) => (e instanceof ApiError ? e.message : undefined);

function Table({ head, children, empty }: { head: string[]; children: React.ReactNode; empty?: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-fg-muted">
          <tr>
            {head.map((h, i) => (
              <th key={h + i} scope="col" className={`px-4 py-3 font-medium ${h.startsWith(">") ? "text-right" : ""}`}>
                {h.replace(/^>/, "")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
      {empty && <p className="px-4 py-6 text-center text-sm text-fg-muted">{empty}</p>}
    </div>
  );
}
const R = "tabular px-4 py-2.5 text-right";
const C = "px-4 py-2.5";

/* ---------------- members ---------------- */

export function MembersTab({ g }: { g: ChitGroupDetail }) {
  const toast = useToast();
  const refresh = useRefreshChits();
  const [enrolFor, setEnrolFor] = useState<number | "next" | null>(null);
  const [transfer, setTransfer] = useState<ChitGroupDetail["tickets"][number] | null>(null);
  const [toCustomer, setToCustomer] = useState<CustomerListItem | null>(null);
  const [reason, setReason] = useState("");
  const [showWait, setShowWait] = useState(false);
  const memberIds = g.tickets.map((t) => t.customer?.id).filter((x): x is string => !!x);

  const enrol = useMutation({
    mutationFn: (v: { customerId: string; ticketNumber?: number }) =>
      api(`/chits/${g.id}/members`, { method: "POST", body: v }),
    onSuccess: () => (refresh(), setEnrolFor(null), toast({ tone: "success", title: "Member enrolled" })),
    onError: (e) => toast({ tone: "danger", title: "Could not enrol", description: errText(e) }),
  });
  const wait = useMutation({
    mutationFn: (customerId: string) => api(`/chits/${g.id}/waitlist`, { method: "POST", body: { customerId } }),
    onSuccess: () => (refresh(), setShowWait(false), toast({ tone: "success", title: "Added to the waiting list" })),
    onError: (e) => toast({ tone: "danger", title: "Could not add", description: errText(e) }),
  });
  const vacate = useMutation({
    mutationFn: (ticketId: string) => api(`/chits/${g.id}/members/${ticketId}`, { method: "DELETE" }),
    onSuccess: () => (refresh(), toast({ tone: "success", title: "Seat is vacant again" })),
    onError: (e) => toast({ tone: "danger", title: "Could not remove", description: errText(e) }),
  });
  const doTransfer = useMutation({
    mutationFn: () =>
      api(`/chits/${g.id}/members/${transfer!.id}/transfer`, {
        method: "POST",
        body: { toCustomerId: toCustomer!.id, reason },
      }),
    onSuccess: () => (
      refresh(),
      setTransfer(null),
      setToCustomer(null),
      setReason(""),
      toast({ tone: "success", title: "Ticket transferred" })
    ),
    onError: (e) => toast({ tone: "danger", title: "Could not transfer", description: errText(e) }),
  });
  const removeWait = useMutation({
    mutationFn: (id: string) => api(`/chits/${g.id}/waitlist/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  const open = g.status === "OPEN_FOR_ENROLMENT";
  const running = g.status === "RUNNING";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="tabular text-sm text-fg-muted">
          {g.filled} of {g.members} seats filled · {g.vacant} vacant
        </p>
        <PermissionGate permission="chit:member_assign">
          {open && (
            <div className="flex gap-2">
              {(g.vacant ?? 0) > 0 ? (
                <Button onClick={() => setEnrolFor("next")}>
                  <UserPlus className="h-4 w-4" aria-hidden /> Add member
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setShowWait(true)}>
                  Add to waiting list
                </Button>
              )}
            </div>
          )}
        </PermissionGate>
      </div>

      <Table head={["Ticket", "Member", "Prize", ">Advance held", ""]}>
        {g.tickets.map((t) => (
          <tr key={t.id}>
            <td className={`${C} tabular font-medium`}>{t.number}</td>
            <td className={C}>
              {t.customer ? (
                <Link to={`/customers/${t.customer.id}`} className="hover:underline">
                  {t.customer.name} <span className="text-fg-muted">({t.customer.code})</span>
                </Link>
              ) : (
                <span className="text-fg-muted">Vacant</span>
              )}
            </td>
            <td className={C}>
              {t.prized ? (
                <StatusBadge tone="success">Won month {t.prizedMonth}</StatusBadge>
              ) : (
                <span className="text-fg-muted">-</span>
              )}
            </td>
            <td className={R}>{inr(t.advancePaise)}</td>
            <td className={`${C} text-right`}>
              <span className="inline-flex flex-wrap justify-end gap-1">
                {t.customer && (running || g.status === "COMPLETED") && (
                  <Button asChild size="sm" variant="ghost">
                    <Link to={`/chits/tickets/${t.id}`} aria-label={`Passbook for ticket ${t.number}`}>
                      <BookOpen className="h-4 w-4" aria-hidden /> Passbook
                    </Link>
                  </Button>
                )}
                <PermissionGate permission="chit:member_assign">
                  {!t.customer && open && (
                    <Button size="sm" variant="secondary" onClick={() => setEnrolFor(t.number)}>
                      Assign
                    </Button>
                  )}
                  {t.customer && open && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ticket ${t.number} member`}
                      onClick={() => vacate.mutate(t.id)}
                    >
                      <UserMinus className="h-4 w-4 text-danger" aria-hidden />
                    </Button>
                  )}
                  {t.customer && (open || running) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Transfer ticket ${t.number}`}
                      onClick={() => setTransfer(t)}
                    >
                      <Repeat className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                </PermissionGate>
              </span>
            </td>
          </tr>
        ))}
      </Table>

      {g.waitlist.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">Waiting list</h3>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
            {g.waitlist.map((w) => (
              <li key={w.id} className="flex items-center justify-between px-4 py-2.5">
                <span>
                  {w.customer?.name} <span className="text-fg-muted">({w.customer?.code})</span>
                </span>
                <PermissionGate permission="chit:member_assign">
                  <button className="text-xs text-danger hover:underline" onClick={() => removeWait.mutate(w.id)}>
                    Remove
                  </button>
                </PermissionGate>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Modal
        open={enrolFor !== null}
        onOpenChange={(o) => !o && setEnrolFor(null)}
        title={enrolFor === "next" ? "Add a member" : `Assign ticket ${enrolFor}`}
      >
        <p className="mb-3 text-sm text-fg-muted">
          Only active customers with completed KYC (Aadhaar, PAN, photo) can join. A customer can hold several tickets.
        </p>
        <CustomerPicker
          onPick={(c) =>
            enrol.mutate({ customerId: c.id, ticketNumber: enrolFor === "next" ? undefined : (enrolFor ?? undefined) })
          }
        />
      </Modal>
      <Modal open={showWait} onOpenChange={setShowWait} title="Add to waiting list">
        <CustomerPicker onPick={(c) => wait.mutate(c.id)} excludeIds={memberIds} />
      </Modal>
      <Modal
        open={!!transfer}
        onOpenChange={(o) => !o && (setTransfer(null), setToCustomer(null))}
        title={`Transfer ticket ${transfer?.number}`}
      >
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">
            The ticket keeps its dues, advance and prize status. The change is recorded with your name and reason.
          </p>
          {toCustomer ? (
            <p className="rounded-md bg-surface-muted p-3 text-sm">
              New member: <strong>{toCustomer.name}</strong> ({toCustomer.code}){" "}
              <button className="text-primary hover:underline" onClick={() => setToCustomer(null)}>
                change
              </button>
            </p>
          ) : (
            <CustomerPicker onPick={setToCustomer} />
          )}
          <Field label="Reason" htmlFor="reason" required>
            <Textarea id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTransfer(null)}>
              Cancel
            </Button>
            <Button
              disabled={!toCustomer || reason.trim().length < 3}
              loading={doTransfer.isPending}
              onClick={() => doTransfer.mutate()}
            >
              Transfer ticket
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ---------------- schedule ---------------- */

export function ScheduleTab({ g, onConduct }: { g: ChitGroupDetail; onConduct: (m: number) => void }) {
  const next = g.cycles.find((c) => c.status !== "CLOSED")?.month;
  return (
    <Table
      head={["Month", "Auction date", "Installments due", "Winner", ">Discount", ">Prize", ">Each pays", ""]}
      empty={g.cycles.length === 0 ? "The schedule is created when the group starts." : undefined}
    >
      {g.cycles.map((c) => {
        const w = g.tickets.find((t) => t.id === c.winnerTicketId);
        return (
          <tr key={c.id}>
            <td className={`${C} tabular font-medium`}>{c.month}</td>
            <td className={`${C} tabular whitespace-nowrap`}>{c.auctionDate}</td>
            <td className={`${C} tabular whitespace-nowrap text-fg-muted`}>{c.dueDate}</td>
            <td className={C}>
              {c.status === "CLOSED" ? (
                `Ticket ${w?.number} · ${w?.customer?.name ?? ""}`
              ) : (
                <StatusBadge tone={c.month === next ? "warning" : "neutral"}>
                  {c.month === next ? "Next auction" : "Scheduled"}
                </StatusBadge>
              )}
            </td>
            <td className={R}>{inr(c.discountPaise)}</td>
            <td className={R}>{inr(c.prizePaise)}</td>
            <td className={R}>{inr(c.netInstallmentPaise)}</td>
            <td className={`${C} text-right`}>
              <Button size="sm" variant={c.month === next ? "primary" : "secondary"} onClick={() => onConduct(c.month)}>
                {c.status === "CLOSED" ? "View" : "Open auction"}
              </Button>
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

/* ---------------- auction ---------------- */

export function AuctionTab({
  g,
  month,
  setMonth,
}: {
  g: ChitGroupDetail;
  month: number;
  setMonth: (m: number) => void;
}) {
  const toast = useToast();
  const refresh = useRefreshChits();
  const can = useCan();
  const [ticketId, setTicketId] = useState("");
  const [discount, setDiscount] = useState<number | undefined>();
  const [confirm, setConfirm] = useState(false);
  const d = useQuery({
    queryKey: ["chit-cycle", g.id, month],
    queryFn: () => api<CycleDetail>(`/chits/${g.id}/cycles/${month}`),
    enabled: g.cycles.length > 0,
  });

  const bid = useMutation({
    mutationFn: () =>
      api(`/chits/${g.id}/cycles/${month}/bids`, { method: "POST", body: { ticketId, discountPaise: discount } }),
    onSuccess: () => (refresh(), setDiscount(undefined), toast({ tone: "success", title: "Bid recorded" })),
    onError: (e) => toast({ tone: "danger", title: "Bid not accepted", description: errText(e) }),
  });
  const close = useMutation({
    mutationFn: () => api(`/chits/${g.id}/cycles/${month}/close`, { method: "POST", body: {} }),
    onSuccess: () => (
      refresh(),
      setConfirm(false),
      toast({ tone: "success", title: "Auction closed", description: "Installments are now payable." })
    ),
    onError: (e) => (
      setConfirm(false),
      toast({ tone: "danger", title: "Could not close the auction", description: errText(e) })
    ),
  });

  if (g.cycles.length === 0)
    return <p className="text-sm text-fg-muted">The auction opens once the group has started.</p>;
  if (d.isLoading || !d.data) return <Skeleton className="h-64 w-full" />;
  const { cycle, limits, bids, eligible, winner } = d.data;
  const closed = cycle.status === "CLOSED";
  const isAuction = g.type === "AUCTION";
  const top = bids.length ? [...bids].sort((a, b) => b.discountPaise - a.discountPaise || a.seq - b.seq)[0]! : null;
  const preview = top
    ? computeAuction({
        chitValuePaise: g.chitValuePaise,
        members: g.members,
        commissionBp: g.commissionBp,
        discountPaise: top.discountPaise,
      })
    : null;
  const b =
    closed && cycle.discountPaise !== null
      ? computeAuction({
          chitValuePaise: g.chitValuePaise,
          members: g.members,
          commissionBp: g.commissionBp,
          discountPaise: isAuction ? cycle.discountPaise : null,
        })
      : preview;

  return (
    <div className="space-y-5" id="auction-sheet">
      <div className="no-print flex flex-wrap items-center gap-3">
        <label htmlFor="month" className="text-sm font-medium">
          Month
        </label>
        <Select id="month" className="max-w-[10rem]" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {g.cycles.map((c) => (
            <option key={c.id} value={c.month}>
              {c.month} · {c.auctionDate}
              {c.status === "CLOSED" ? " ✓" : ""}
            </option>
          ))}
        </Select>
        <StatusBadge tone={closed ? "success" : "warning"}>{closed ? "Closed" : "Open"}</StatusBadge>
        {closed && (
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden /> Print auction sheet
          </Button>
        )}
      </div>

      <div className="hidden print:block">
        <h2 className="text-xl font-semibold">
          Auction sheet · {g.name} ({g.code})
        </h2>
        <p>
          Month {cycle.month} · {cycle.auctionDate}
        </p>
      </div>

      {!closed && isAuction && can("chit:auction_conduct") && (
        <form
          className="no-print grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            bid.mutate();
          }}
        >
          <Field label="Bidder (ticket)" htmlFor="ticket">
            <Select id="ticket" value={ticketId} onChange={(e) => setTicketId(e.target.value)}>
              <option value="">Select a ticket</option>
              {eligible.map((t) => (
                <option key={t.ticketId} value={t.ticketId} disabled={t.inArrears}>
                  {t.number} · {t.customerName}
                  {t.inArrears ? " (unpaid dues)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Discount bid (₹)"
            htmlFor="discount"
            hint={`${inr(limits.minDiscountPaise)} to ${inr(limits.maxDiscountPaise)}`}
          >
            <RupeeInput key={bids.length} id="discount" onPaise={setDiscount} />
          </Field>
          <Button type="submit" loading={bid.isPending} disabled={!ticketId || !discount}>
            <Gavel className="h-4 w-4" aria-hidden /> Record bid
          </Button>
        </form>
      )}
      {!closed && !isAuction && (
        <p className="rounded-md bg-info-soft p-3 text-sm text-info">
          This is a {g.type === "LOTTERY" ? "lottery" : "fixed-order"} chit: there are no bids. Closing the month{" "}
          {g.type === "LOTTERY"
            ? "draws a winner at random from the eligible tickets"
            : "awards the prize to the next ticket in order"}
          .
        </p>
      )}

      {isAuction && (
        <section>
          <h3 className="mb-2 font-semibold">Bids (recorded in order; cannot be edited)</h3>
          <Table
            head={["#", "Ticket", "Member", ">Discount", "Recorded"]}
            empty={bids.length === 0 ? "No bids yet." : undefined}
          >
            {bids.map((x) => (
              <tr
                key={x.id}
                className={
                  winner?.ticketId === x.ticketId && x.discountPaise === cycle.discountPaise ? "bg-success-soft" : ""
                }
              >
                <td className={`${C} tabular`}>{x.seq}</td>
                <td className={`${C} tabular`}>{x.number}</td>
                <td className={C}>{x.customerName}</td>
                <td className={R}>{inr(x.discountPaise)}</td>
                <td className={`${C} tabular whitespace-nowrap text-fg-muted`}>{formatDateTime(x.at)}</td>
              </tr>
            ))}
          </Table>
        </section>
      )}

      {b && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 font-semibold">
            {closed ? "Result" : "If the highest bid wins"}
            {winner ? `: ticket ${winner.number} · ${winner.customerName}` : ""}
          </h3>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Chit value", inr(g.chitValuePaise)],
              ["Winning discount", inr(b.discountPaise)],
              [`Foreman commission (${pct(g.commissionBp)})`, inr(b.commissionPaise)],
              ["Dividend pool (discount − commission)", inr(b.dividendPoolPaise)],
              [`Dividend per member (÷ ${g.members})`, inr(b.dividendPerMemberPaise)],
              ["Paise left over (to foreman)", inr(b.residuePaise, true)],
              ["Prize payable to winner", inr(b.prizePaise)],
              ["Each member pays this month", inr(b.netInstallmentPaise)],
              ["Total collected this month", inr(b.netInstallmentPaise * g.members)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-fg-muted">{k}</dt>
                <dd className="tabular mt-0.5 font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-fg-muted">
            Check: {g.members} × {inr(b.netInstallmentPaise)} = prize {inr(b.prizePaise)} + foreman{" "}
            {inr(b.foremanIncomePaise, true)}
          </p>
          {cycle.note && <p className="mt-2 text-sm text-fg-muted">{cycle.note}</p>}
        </section>
      )}

      {!closed && (
        <PermissionGate permission="chit:auction_conduct">
          <div className="no-print flex justify-end">
            <Button size="touch" disabled={isAuction && bids.length === 0} onClick={() => setConfirm(true)}>
              Close month {month} and declare winner
            </Button>
          </div>
        </PermissionGate>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Close month ${month}?`}
        description="This declares the winner, fixes everyone's installment for the month and books the foreman's commission. It cannot be undone."
        customer={preview && top ? `Ticket ${top.number} · ${top.customerName}` : undefined}
        subjectLabel="Winner"
        amountPaise={preview?.prizePaise}
        confirmLabel="Close and declare winner"
        loading={close.isPending}
        onConfirm={() => close.mutate()}
      />
    </div>
  );
}

/* ---------------- collections ---------------- */

export function CollectionsTab({ g }: { g: ChitGroupDetail }) {
  const [ticketId, setTicketId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["chit-collections", g.id],
    queryFn: () =>
      api<{ asOf: string; rows: CollectionRow[]; totals: { outstandingPaise: number; overduePaise: number } }>(
        `/chits/${g.id}/collections`,
      ),
    enabled: g.status === "RUNNING" || g.status === "COMPLETED",
  });
  if (g.status !== "RUNNING" && g.status !== "COMPLETED")
    return <p className="text-sm text-fg-muted">Collections start once the group is running.</p>;
  if (q.isLoading || !q.data) return <Skeleton className="h-48 w-full" />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs text-fg-muted">Outstanding</p>
          <p className="tabular mt-1 text-xl font-semibold">{inr(q.data.totals.outstandingPaise)}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs text-fg-muted">Overdue</p>
          <p className="tabular mt-1 text-xl font-semibold text-danger">{inr(q.data.totals.overduePaise)}</p>
        </div>
      </div>
      <ul className="space-y-2 md:hidden" aria-label="Members to collect from">
        {q.data.rows.map((r) => (
          <li
            key={r.ticketId}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">
                <span className="tabular text-fg-muted">#{r.number}</span> {r.customerName}
              </p>
              <p className="text-xs text-fg-muted">{r.phone}</p>
              <p className="tabular mt-1 text-sm">
                Due <strong>{inr(r.outstandingPaise)}</strong>
                {r.overduePaise > 0 && <span className="ml-2 text-danger">Overdue {inr(r.overduePaise)}</span>}
                {r.penaltyPaise > 0 && <span className="ml-2 text-fg-muted">+ {inr(r.penaltyPaise)} penalty</span>}
              </p>
            </div>
            <PermissionGate permission="payment:create">
              <Button
                size="touch"
                onClick={() => setTicketId(r.ticketId)}
                aria-label={`Collect from ticket ${r.number}`}
              >
                Collect
              </Button>
            </PermissionGate>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table head={["Ticket", "Member", ">Outstanding", ">Overdue", ">Penalty", ">Advance", ""]}>
          {q.data.rows.map((r) => (
            <tr key={r.ticketId}>
              <td className={`${C} tabular font-medium`}>{r.number}</td>
              <td className={C}>
                {r.customerName}
                <span className="block text-xs text-fg-muted">{r.phone}</span>
              </td>
              <td className={R}>{inr(r.outstandingPaise)}</td>
              <td className={`${R} ${r.overduePaise ? "text-danger" : ""}`}>{inr(r.overduePaise)}</td>
              <td className={R}>{inr(r.penaltyPaise)}</td>
              <td className={R}>{inr(r.advancePaise)}</td>
              <td className={`${C} text-right`}>
                <PermissionGate permission="payment:create">
                  <Button
                    size="sm"
                    onClick={() => setTicketId(r.ticketId)}
                    aria-label={`Collect from ticket ${r.number}`}
                  >
                    Collect
                  </Button>
                </PermissionGate>
              </td>
            </tr>
          ))}
        </Table>
      </div>
      {ticketId && <PaymentDialog ticketId={ticketId} onClose={() => setTicketId(null)} />}
    </div>
  );
}

/* ---------------- payouts ---------------- */

export function PayoutsTab({ g }: { g: ChitGroupDetail }) {
  const toast = useToast();
  const refresh = useRefreshChits();
  const [approve, setApprove] = useState<Payout | null>(null);
  const [pay, setPay] = useState<Payout | null>(null);
  const [verified, setVerified] = useState(false);
  const [note, setNote] = useState("");
  const [mode, setMode] = useState("CASH");
  const [ref, setRef] = useState("");
  const q = useQuery({
    queryKey: ["chit-payouts", g.id],
    queryFn: () => api<Payout[]>("/chits/payouts", { query: { groupId: g.id } }),
  });

  const doApprove = useMutation({
    mutationFn: () =>
      api(`/chits/payouts/${approve!.id}/approve`, {
        method: "POST",
        body: { securityVerified: verified, note: note || undefined },
      }),
    onSuccess: () => (
      refresh(),
      setApprove(null),
      setVerified(false),
      setNote(""),
      toast({
        tone: "success",
        title: "Payout approved",
        description: "Any dues of the winner were set off against the prize.",
      })
    ),
    onError: (e) => toast({ tone: "danger", title: "Could not approve", description: errText(e) }),
  });
  const doPay = useMutation({
    mutationFn: () =>
      api(`/chits/payouts/${pay!.id}/pay`, { method: "POST", body: { mode, reference: ref || undefined } }),
    onSuccess: () => (refresh(), setPay(null), setRef(""), toast({ tone: "success", title: "Payout recorded" })),
    onError: (e) => toast({ tone: "danger", title: "Could not record the payout", description: errText(e) }),
  });

  if (q.isLoading) return <Skeleton className="h-32 w-full" />;
  const tone = { PENDING: "warning", APPROVED: "info", PAID: "success" } as const;
  return (
    <>
      <Table
        head={["Month", "Winner", ">Prize", ">Set off dues", ">Net to pay", "Status", ""]}
        empty={q.data?.length === 0 ? "Prize payouts appear here after each auction is closed." : undefined}
      >
        {q.data?.map((p) => (
          <tr key={p.id}>
            <td className={`${C} tabular`}>{p.month}</td>
            <td className={C}>
              Ticket {p.ticketNumber} · {p.customer?.name}
            </td>
            <td className={R}>{inr(p.prizePaise)}</td>
            <td className={R}>{p.status === "PENDING" ? "-" : inr(p.setOffPaise)}</td>
            <td className={R}>{p.status === "PENDING" ? "-" : inr(p.netPaise)}</td>
            <td className={C}>
              <StatusBadge tone={tone[p.status]}>{p.status.charAt(0) + p.status.slice(1).toLowerCase()}</StatusBadge>
            </td>
            <td className={`${C} text-right`}>
              <PermissionGate permission="chit:payout_approve">
                {p.status === "PENDING" && (
                  <Button size="sm" onClick={() => setApprove(p)}>
                    Approve
                  </Button>
                )}
                {p.status === "APPROVED" && (
                  <Button size="sm" onClick={() => (setMode("CASH"), setPay(p))}>
                    Record payment
                  </Button>
                )}
              </PermissionGate>
            </td>
          </tr>
        ))}
      </Table>

      <Modal open={!!approve} onOpenChange={(o) => !o && setApprove(null)} title="Approve prize payout">
        {approve && (
          <div className="space-y-4">
            <p className="rounded-md bg-surface-muted p-3 text-sm">
              Ticket {approve.ticketNumber} · {approve.customer?.name}: prize{" "}
              <strong className="tabular">{inr(approve.prizePaise)}</strong>. Any unpaid installments of this member are
              settled from the prize first.
            </p>
            <label className="flex min-h-touch items-start gap-3 text-sm md:min-h-0">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={verified}
                onChange={(e) => setVerified(e.target.checked)}
              />
              <span>I have checked the security / guarantor documents for this member and they are in order.</span>
            </label>
            <Field label="Note" htmlFor="note">
              <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setApprove(null)}>
                Cancel
              </Button>
              <Button disabled={!verified} loading={doApprove.isPending} onClick={() => doApprove.mutate()}>
                Approve payout
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!pay} onOpenChange={(o) => !o && setPay(null)} title="Record prize payment">
        {pay && (
          <div className="space-y-4">
            <p className="rounded-md bg-surface-muted p-3 text-sm">
              Pay <strong className="tabular">{inr(pay.netPaise)}</strong> to {pay.customer?.name} (prize{" "}
              {inr(pay.prizePaise)}
              {pay.setOffPaise ? ` − dues set off ${inr(pay.setOffPaise)}` : ""}).
            </p>
            {pay.netPaise > 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Paid by" htmlFor="pmode">
                  <Select id="pmode" value={mode} onChange={(e) => setMode(e.target.value)}>
                    {MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Reference / voucher no." htmlFor="pref">
                  <Input id="pref" value={ref} onChange={(e) => setRef(e.target.value)} />
                </Field>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPay(null)}>
                Cancel
              </Button>
              <Button loading={doPay.isPending} onClick={() => doPay.mutate()}>
                Confirm payment of {inr(pay.netPaise)}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

/* ---------------- statement ---------------- */

export function StatementTab({ g }: { g: ChitGroupDetail }) {
  const q = useQuery({ queryKey: ["chit-statement", g.id], queryFn: () => api<Statement>(`/chits/${g.id}/statement`) });
  if (q.isLoading || !q.data) return <Skeleton className="h-48 w-full" />;
  const s = q.data;
  return (
    <div className="space-y-4">
      <div className="no-print flex justify-end">
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer className="h-4 w-4" aria-hidden /> Print statement
        </Button>
      </div>
      <Table
        head={[
          "Month",
          "Auction",
          "Winner",
          ">Discount",
          ">Commission",
          ">Prize",
          "Payout",
          ">Due",
          ">Collected",
          ">Outstanding",
        ]}
        empty={s.months.length === 0 ? "Nothing to show until the group starts." : undefined}
      >
        {s.months.map((m) => (
          <tr key={m.month}>
            <td className={`${C} tabular font-medium`}>{m.month}</td>
            <td className={`${C} tabular whitespace-nowrap text-fg-muted`}>{m.auctionDate}</td>
            <td className={C}>{m.winnerTicket ? `Ticket ${m.winnerTicket}` : "-"}</td>
            <td className={R}>{inr(m.discountPaise)}</td>
            <td className={R}>{inr(m.commissionPaise)}</td>
            <td className={R}>{inr(m.prizePaise)}</td>
            <td className={C}>{m.payoutStatus?.toLowerCase() ?? "-"}</td>
            <td className={R}>{inr(m.dueTotalPaise)}</td>
            <td className={R}>{inr(m.collectedPaise)}</td>
            <td className={R}>{inr(m.outstandingPaise)}</td>
          </tr>
        ))}
        {s.months.length > 0 && (
          <tr className="bg-surface-muted font-semibold">
            <td className={C} colSpan={7}>
              Total
            </td>
            <td className={R}>{inr(s.totals.dueTotalPaise)}</td>
            <td className={R}>{inr(s.totals.collectedPaise)}</td>
            <td className={R}>{inr(s.totals.outstandingPaise)}</td>
          </tr>
        )}
      </Table>
      <p className="text-sm text-fg-muted">
        {s.poolBalancePaise >= 0 ? (
          <>
            Held for members in the ledger: <strong className="tabular text-fg">{inr(s.poolBalancePaise, true)}</strong>{" "}
            (cash collected less commission and prizes paid). It returns to zero when the chit is fully settled.
          </>
        ) : (
          <>
            Prizes paid so far exceed the cash collected by{" "}
            <strong className="tabular text-fg">{inr(-s.poolBalancePaise, true)}</strong>. This balances out as the
            remaining installments are collected.
          </>
        )}
      </p>
    </div>
  );
}
