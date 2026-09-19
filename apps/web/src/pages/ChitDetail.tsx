import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, Copy } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCan } from "@/auth/permissions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { PermissionGate } from "@/components/ui/permission-gate";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  AuctionTab,
  CollectionsTab,
  MembersTab,
  PayoutsTab,
  ScheduleTab,
  StatementTab,
  useRefreshChits,
} from "@/features/chits/tabs";
import type { ChitGroupDetail } from "@/features/chits/types";
import { ChitStatusBadge, TYPE_LABEL, inr, pct } from "@/features/chits/ui";

const TABS = ["overview", "members", "schedule", "auction", "collections", "payouts", "statement"] as const;
type Tab = (typeof TABS)[number];
const LABEL: Record<Tab, string> = {
  overview: "Overview",
  members: "Members",
  schedule: "Schedule",
  auction: "Auction",
  collections: "Collections",
  payouts: "Payouts",
  statement: "Statement",
};

export default function ChitDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshChits();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get("tab") as Tab) ? params.get("tab") : "overview") as Tab;
  const [month, setMonth] = useState(1);
  const [confirm, setConfirm] = useState<"start" | "complete" | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  const q = useQuery({ queryKey: ["chit", id], queryFn: () => api<ChitGroupDetail>(`/chits/${id}`) });
  const g = q.data;

  // Land on the next unclosed month when the group loads
  const nextMonth = g?.cycles.find((c) => c.status !== "CLOSED")?.month ?? g?.cycles.at(-1)?.month;
  // Pick the month once, when the group first loads. It must NOT follow "next month" afterwards: right after closing a
  // month, the user should still see that month's result (and be able to print the auction sheet).
  const picked = useRef(false);
  useEffect(() => {
    if (nextMonth && !picked.current) {
      picked.current = true;
      setMonth(nextMonth);
    }
  }, [nextMonth]);

  const act = useMutation({
    mutationFn: (a: { path: string; body?: object; done: string }) =>
      api<ChitGroupDetail>(`/chits/${id}/${a.path}`, { method: "POST", body: a.body ?? {} }).then((r) => ({
        r,
        done: a.done,
      })),
    onSuccess: ({ done }) => (
      refresh(),
      setConfirm(null),
      setCancelling(false),
      toast({ tone: "success", title: done })
    ),
    onError: (e) => (
      setConfirm(null),
      toast({ tone: "danger", title: "Not allowed yet", description: e instanceof ApiError ? e.message : undefined })
    ),
  });
  const clone = useMutation({
    mutationFn: () => api<{ id: string }>(`/chits/${id}/clone`, { method: "POST" }),
    onSuccess: (c) => (toast({ tone: "success", title: "Copied as a new draft" }), navigate(`/chits/${c.id}`)),
  });

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!g)
    return (
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold">Chit group not found</h1>
        <Button asChild variant="secondary" className="mt-4">
          <Link to="/chits">Back to Chit Funds</Link>
        </Button>
      </div>
    );

  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });
  const started = g.status === "RUNNING" || g.status === "COMPLETED";
  const tabs = TABS.filter((t) =>
    t === "collections" ? can("payment:view") : t === "payouts" ? can("chit:view") : true,
  );

  return (
    <div className="space-y-5">
      <Link
        to="/chits"
        className="no-print inline-flex min-h-touch items-center gap-1 text-sm hover:underline md:min-h-0"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden /> Back to Chit Funds
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-surface p-5">
        <div>
          <h1 className="text-xl font-semibold">{g.name}</h1>
          <p className="text-sm text-fg-muted">
            {g.code} · {TYPE_LABEL[g.type]}
          </p>
          <div className="mt-2">
            <ChitStatusBadge status={g.status} />
          </div>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <PermissionGate permission="chit:edit">
            {g.status === "DRAFT" && (
              <Button onClick={() => act.mutate({ path: "open", done: "Open for enrolment" })} loading={act.isPending}>
                Open for enrolment
              </Button>
            )}
            {g.status === "OPEN_FOR_ENROLMENT" && <Button onClick={() => setConfirm("start")}>Start chit</Button>}
            {g.status === "RUNNING" && (
              <Button variant="secondary" onClick={() => setConfirm("complete")}>
                Complete chit
              </Button>
            )}
            {(g.status === "DRAFT" || g.status === "OPEN_FOR_ENROLMENT") && (
              <Button variant="secondary" onClick={() => setCancelling(true)}>
                Cancel group
              </Button>
            )}
          </PermissionGate>
          <PermissionGate permission="chit:create">
            <Button variant="secondary" onClick={() => clone.mutate()} loading={clone.isPending}>
              <Copy className="h-4 w-4" aria-hidden /> Clone
            </Button>
          </PermissionGate>
        </div>
      </div>

      <div role="tablist" aria-label="Chit group sections" className="no-print flex gap-2 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "min-h-touch shrink-0 rounded-md border px-4 text-sm font-medium md:min-h-10",
              tab === t
                ? "border-primary bg-primary text-fg-inverse"
                : "border-border bg-surface hover:bg-surface-muted",
            )}
          >
            {LABEL[t]}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "overview" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-border bg-surface p-5">
              <h2 className="mb-3 font-semibold">Terms</h2>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                {[
                  ["Chit value", inr(g.chitValuePaise)],
                  ["Monthly subscription", inr(g.monthlySubscriptionPaise)],
                  ["Members / duration", `${g.members} members · ${g.durationMonths} months`],
                  [
                    "Foreman commission",
                    `${pct(g.commissionBp)} (${inr((g.chitValuePaise * g.commissionBp) / 10_000)})`,
                  ],
                  ...(g.type === "AUCTION"
                    ? [["Bid range", `${pct(g.minBidBp)} to ${pct(g.maxBidBp)} of chit value`]]
                    : []),
                  ["First month", g.startDate],
                  ["Auction day", `Day ${g.auctionDay} of each month`],
                  ["Installment due", `${g.dueDaysAfterAuction} days after the auction`],
                  [
                    "Late penalty",
                    g.penaltyRateBp
                      ? `${pct(g.penaltyRateBp)} per month after ${g.penaltyGraceDays} grace days`
                      : "None",
                  ],
                  ["Registration fee", inr(g.registrationFeePaise)],
                ].map(([k, v]) => (
                  <div key={k as string}>
                    <dt className="text-xs text-fg-muted">{k}</dt>
                    <dd className="mt-0.5">{v}</dd>
                  </div>
                ))}
              </dl>
              {g.notes && <p className="mt-4 text-sm text-fg-muted">{g.notes}</p>}
              {g.cancelledReason && <p className="mt-4 text-sm text-danger">Cancelled: {g.cancelledReason}</p>}
            </section>
            <section className="rounded-lg border border-border bg-surface p-5">
              <h2 className="mb-3 font-semibold">Progress</h2>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-xs text-fg-muted">Seats filled</dt>
                  <dd className="tabular mt-0.5 text-lg font-semibold">
                    {g.filled} / {g.members}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-muted">Auctions held</dt>
                  <dd className="tabular mt-0.5 text-lg font-semibold">
                    {g.closedMonths ?? 0} / {g.durationMonths}
                  </dd>
                </div>
              </dl>
              {g.status === "DRAFT" && (
                <p className="mt-4 text-sm text-fg-muted">
                  Next: open the group for enrolment, then add members from the Members tab.
                </p>
              )}
              {g.status === "OPEN_FOR_ENROLMENT" && (
                <p className="mt-4 text-sm text-fg-muted">
                  {(g.vacant ?? 0) > 0
                    ? `${g.vacant} seat(s) still to fill before the chit can start.`
                    : "All seats are filled. You can start the chit."}
                </p>
              )}
              {started && nextMonth && g.status === "RUNNING" && (
                <p className="mt-4 text-sm">
                  <button
                    className="text-primary hover:underline"
                    onClick={() => (setMonth(nextMonth), setTab("auction"))}
                  >
                    Go to the month {nextMonth} auction
                  </button>
                </p>
              )}
            </section>
          </div>
        )}
        {tab === "members" && <MembersTab g={g} />}
        {tab === "schedule" && <ScheduleTab g={g} onConduct={(m) => (setMonth(m), setTab("auction"))} />}
        {tab === "auction" && <AuctionTab g={g} month={month} setMonth={setMonth} />}
        {tab === "collections" && <CollectionsTab g={g} />}
        {tab === "payouts" && <PayoutsTab g={g} />}
        {tab === "statement" && <StatementTab g={g} />}
      </div>

      <ConfirmDialog
        open={confirm === "start"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Start this chit?"
        description="Membership is locked and the month-by-month schedule is created. Members can still be transferred, but not added or removed."
        subjectLabel="Group"
        customer={`${g.name} (${g.code})`}
        amountPaise={g.chitValuePaise}
        confirmLabel="Start chit"
        loading={act.isPending}
        onConfirm={() => act.mutate({ path: "start", done: "Chit started. The schedule is ready." })}
      />
      <ConfirmDialog
        open={confirm === "complete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Complete this chit?"
        description="Allowed only when every auction is held, every prize is paid and every installment is settled."
        subjectLabel="Group"
        customer={`${g.name} (${g.code})`}
        confirmLabel="Complete chit"
        loading={act.isPending}
        onConfirm={() => act.mutate({ path: "complete", done: "Chit completed" })}
      />
      <Modal open={cancelling} onOpenChange={setCancelling} title="Cancel this group?">
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">Only groups that have not started can be cancelled.</p>
          <Field label="Reason" htmlFor="creason" required>
            <Textarea id="creason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCancelling(false)}>
              Keep group
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 3}
              loading={act.isPending}
              onClick={() => act.mutate({ path: "cancel", body: { reason }, done: "Group cancelled" })}
            >
              Cancel group
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
