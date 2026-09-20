import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { inrCompact } from "@/lib/format";
import { useUser } from "@/auth/auth-context";
import { EmptyState, Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { BucketBars, ColumnChart, Panel, ShareRows, StatTile } from "@/features/dashboard/charts";
import type { Dashboard as Data } from "@/features/dashboard/types";
import type { FollowUp } from "@/features/customers/types";
import { inr } from "@/features/chits/ui";

const KYC_LABEL = {
  VERIFIED: "Verified",
  COMPLETE: "Awaiting review",
  PARTIAL: "Partial",
  NOT_STARTED: "Not started",
  EXPIRED: "Expired",
} as const;
const RISK_LABEL = { LOW: "Low risk", MEDIUM: "Medium risk", HIGH: "High risk" } as const;

function FollowUps() {
  const q = useQuery({ queryKey: ["follow-ups"], queryFn: () => api<FollowUp[]>("/customers/follow-ups") });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Panel title="Follow-ups due" subtitle="Calls and visits you scheduled on customers">
      {q.isLoading ? (
        <Skeleton className="h-16" />
      ) : q.data?.length ? (
        <ul className="-my-1 divide-y divide-border">
          {q.data.slice(0, 6).map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <div className="min-w-0">
                <Link to={`/customers/${f.customer.id}`} className="font-medium hover:underline">
                  {f.customer.name}
                </Link>{" "}
                <span className="text-fg-muted">({f.customer.code})</span>
                <p className="truncate text-fg-muted">{f.outcome ?? f.body}</p>
              </div>
              <StatusBadge tone={f.followUpOn < today ? "danger" : "warning"}>
                {f.followUpOn < today ? "Overdue" : "Today"} · {f.followUpOn}
              </StatusBadge>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="Nothing due"
          description="Follow-ups you schedule on customers show up here on their due date."
        />
      )}
    </Panel>
  );
}

export default function Dashboard() {
  const user = useUser();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Data>("/dashboard"), refetchInterval: 60_000 });
  const d = q.data;

  if (q.isLoading || !d) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }
  const { customers: c, chits, collections, overdue, cash, staff, followUps, loans } = d;
  const nothing = !c && !chits && !collections && !loans;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-fg-muted">Welcome, {user.name}.</p>
        </div>
        <p className="tabular text-xs text-fg-muted">As of {d.asOf}</p>
      </div>

      {nothing && (
        <EmptyState
          title="Nothing to show yet"
          description="Your role does not include any dashboard sections. Ask the owner to grant access."
        />
      )}

      {(collections || overdue || cash) && (
        <section aria-label="Money" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {collections && (
            <StatTile
              hero
              label="Collected today"
              value={inrCompact(collections.todayPaise)}
              hint={`${collections.todayCount} receipt${collections.todayCount === 1 ? "" : "s"}`}
            />
          )}
          {collections && (
            <StatTile
              label="Collected this month"
              value={inrCompact(collections.monthPaise)}
              hint={`${collections.monthCount} receipt${collections.monthCount === 1 ? "" : "s"}`}
            />
          )}
          {overdue && (
            <StatTile
              label="Overdue"
              tone={overdue.totalPaise > 0 ? "danger" : undefined}
              value={inrCompact(overdue.totalPaise)}
              hint={`${overdue.members} installment holder${overdue.members === 1 ? "" : "s"} behind`}
            />
          )}
          {cash && (
            <StatTile
              label="Cash and bank"
              value={inrCompact(cash.totalPaise)}
              hint={
                cash.cashPaise < 0
                  ? `Cash ${inrCompact(cash.cashPaise)} · Bank ${inrCompact(cash.bankPaise)}. Cash shows negative until an opening balance is recorded.`
                  : `Cash ${inrCompact(cash.cashPaise)} · Bank ${inrCompact(cash.bankPaise)}`
              }
            />
          )}
        </section>
      )}

      {loans && (
        <>
          <section aria-label="Loans" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Loan principal outstanding"
              value={inrCompact(loans.principalOutstandingPaise)}
              hint={`${loans.active} active loan${loans.active === 1 ? "" : "s"}${loans.waitingApproval ? ` · ${loans.waitingApproval} waiting for approval` : ""}`}
              href="/loans"
            />
            <StatTile
              label="Interest overdue"
              tone={loans.interestOverduePaise > 0 ? "danger" : undefined}
              value={inrCompact(loans.interestOverduePaise)}
              hint={`${loans.overdueLoans} loan${loans.overdueLoans === 1 ? "" : "s"} behind`}
              href="/loans"
            />
            <StatTile
              label="Interest received this month"
              value={inrCompact(loans.month.interestPaise)}
              hint={`Today ${inrCompact(loans.today.interestPaise)} · ${loans.month.count} receipt${loans.month.count === 1 ? "" : "s"}`}
            />
            <StatTile
              label="Interest due in 7 days"
              value={String(loans.dueThisWeek)}
              hint={`${inrCompact(loans.interestDuePaise)} due right now`}
              href="/loans"
            />
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="Loan interest collected, last 6 months"
              subtitle="Interest received on loans (principal repaid is not counted)"
            >
              <ColumnChart data={loans.months} ariaLabel="Loan interest collected by month for the last six months" />
            </Panel>
            <Panel title="Loans furthest behind" subtitle="Longest overdue interest first">
              {loans.topOverdue.length ? (
                <div className="-mx-4 overflow-x-auto px-4">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-fg-muted">
                      <tr>
                        <th className="py-1 font-medium">Customer</th>
                        <th className="py-1 text-right font-medium">Days late</th>
                        <th className="py-1 text-right font-medium">Overdue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loans.topOverdue.map((t) => (
                        <tr key={t.id} className="border-t border-border">
                          <td className="py-2">
                            <Link to={`/loans/${t.id}`} className="font-medium hover:underline">
                              {t.customerName}
                            </Link>
                            <span className="block text-xs text-fg-muted">
                              {t.code}
                              {t.phone ? ` · ${t.phone}` : ""}
                            </span>
                          </td>
                          <td className="tabular py-2 text-right">{t.overdueDays}</td>
                          <td className="tabular py-2 text-right font-medium">{inr(t.overduePaise)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="No loan is behind on interest" description="Every finished month has been paid." />
              )}
            </Panel>
          </div>
        </>
      )}

      {(c || chits) && (
        <section aria-label="Business" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {c && (
            <StatTile
              label="Active customers"
              value={String(c.active)}
              hint={`${c.total} in total · ${c.drafts} draft${c.drafts === 1 ? "" : "s"}`}
              href="/customers"
            />
          )}
          {chits && (
            <StatTile
              label="Running chit groups"
              value={String(chits.running)}
              hint={`${chits.open} open for enrolment`}
              href="/chits"
            />
          )}
          {c && (
            <StatTile
              label="KYC pending"
              value={String(c.kycPending)}
              tone={c.kycPending > 0 ? undefined : "success"}
              hint="Active customers not fully verified"
              href="/customers"
            />
          )}
          {c && (
            <StatTile
              label="High-risk customers"
              value={String(c.highRisk)}
              hint={
                c.blacklist + c.watchlist > 0
                  ? `${c.blacklist} blacklisted · ${c.watchlist} on watchlist`
                  : "None flagged"
              }
              href="/customers"
            />
          )}
        </section>
      )}

      {(collections || overdue) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {collections && (
            <Panel
              title="Collections, last 6 months"
              subtitle="Money received from chit members (prize set-offs excluded)"
            >
              <ColumnChart data={collections.months} ariaLabel="Collections by month for the last six months" />
            </Panel>
          )}
          {overdue && (
            <Panel title="Overdue ageing" subtitle={`${inrCompact(overdue.totalPaise)} past due, by days past due`}>
              {overdue.totalPaise === 0 ? (
                <EmptyState title="Nothing overdue" description="Every installment that has fallen due is paid." />
              ) : (
                <BucketBars
                  unit="installments"
                  ariaLabel="Overdue amount by days past due"
                  rows={overdue.buckets.map((b) => ({ label: b.bucket, paise: b.paise, count: b.count }))}
                />
              )}
            </Panel>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {chits && (
          <Panel
            title="Upcoming auctions"
            subtitle="Next unheld month of each running group, next 30 days"
            action={
              chits.pendingPayouts > 0 ? (
                <StatusBadge tone="warning">
                  {chits.pendingPayouts} payout{chits.pendingPayouts === 1 ? "" : "s"} pending ·{" "}
                  {inrCompact(chits.pendingPayoutsPaise)}
                </StatusBadge>
              ) : undefined
            }
          >
            {chits.upcomingAuctions.length ? (
              <ul className="-my-1 divide-y divide-border">
                {chits.upcomingAuctions.map((a) => (
                  <li key={a.groupId} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <Link to={`/chits/${a.groupId}?tab=auction`} className="font-medium hover:underline">
                      {a.name} <span className="text-fg-muted">· month {a.month}</span>
                    </Link>
                    <StatusBadge tone={a.overdue ? "danger" : "info"}>
                      {a.overdue ? "Not held yet" : "Scheduled"} · <span className="tabular">{a.date}</span>
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No auctions in the next 30 days" />
            )}
          </Panel>
        )}
        {overdue && (
          <Panel title="Top defaulters" subtitle="Largest overdue balances">
            {overdue.topDefaulters.length ? (
              <div className="-mx-4 overflow-x-auto px-4">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-fg-muted">
                    <tr>
                      <th className="py-1 font-medium">Customer</th>
                      <th className="py-1 text-right font-medium">Days late</th>
                      <th className="py-1 text-right font-medium">Overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdue.topDefaulters.map((t) => (
                      <tr key={t.customerId} className="border-t border-border">
                        <td className="py-2">
                          <Link to={`/customers/${t.customerId}`} className="font-medium hover:underline">
                            {t.name}
                          </Link>
                          <span className="block text-xs text-fg-muted">{t.phone}</span>
                        </td>
                        <td className="tabular py-2 text-right">{t.daysPastDue}</td>
                        <td className="tabular py-2 text-right font-medium">{inr(t.overduePaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No defaulters" />
            )}
          </Panel>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {c && (
          <Panel title="KYC status" subtitle="Active customers">
            <ShareRows
              total={c.active}
              rows={(Object.keys(KYC_LABEL) as (keyof typeof KYC_LABEL)[]).map((k) => ({
                label: KYC_LABEL[k],
                count: c.kyc[k],
              }))}
            />
          </Panel>
        )}
        {c && (
          <Panel title="Risk mix" subtitle="Active customers">
            <ShareRows
              total={c.active}
              rows={(Object.keys(RISK_LABEL) as (keyof typeof RISK_LABEL)[]).map((k) => ({
                label: RISK_LABEL[k],
                count: c.risk[k],
              }))}
            />
          </Panel>
        )}
        {staff && (
          <Panel title="Staff collections this month" subtitle="By who took the payment (receipts in brackets)">
            {staff.collectionsThisMonth.length ? (
              <ShareRows
                format={(n) => inrCompact(n)}
                total={staff.collectionsThisMonth.reduce((s, r) => s + r.paise, 0)}
                rows={staff.collectionsThisMonth.map((r) => ({ label: `${r.name} (${r.receipts})`, count: r.paise }))}
              />
            ) : (
              <EmptyState title="No collections yet this month" />
            )}
          </Panel>
        )}
      </div>

      {(c || followUps) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <FollowUps />
          {cash && (
            <Panel title="Held for chit members" subtitle="Cash collected less commission and prizes paid">
              <p className="tabular text-3xl font-semibold">{inrCompact(cash.heldForMembersPaise)}</p>
              <p className="mt-2 text-sm text-fg-muted">
                {cash.heldForMembersPaise < 0
                  ? "Prizes paid so far exceed the cash collected. This balances as remaining installments come in."
                  : "This is owed back to members as prizes and stays in your cash and bank position until paid out."}
              </p>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
