import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import { monthlyInterest } from "@jana/shared";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCan } from "@/auth/permissions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { CollectDialog } from "@/features/loans/CollectDialog";
import { ApproveDialog, DisburseDialog, RejectDialog, useRefreshLoans } from "@/features/loans/dialogs";
import { InterestTab, OverviewTab, PaymentsTab, SecurityTab } from "@/features/loans/tabs";
import type { LoanDetail as Loan } from "@/features/loans/types";
import { DueBadge, LoanStatusBadge, Stat, fmtDate, inr, ratePct } from "@/features/loans/ui";

const TABS = ["overview", "interest", "payments", "security"] as const;
type Tab = (typeof TABS)[number];
const LABEL: Record<Tab, string> = {
  overview: "Overview",
  interest: "Interest",
  payments: "Payments",
  security: "Security",
};

export default function LoanDetail() {
  const { id = "" } = useParams();
  const can = useCan();
  const toast = useToast();
  const refresh = useRefreshLoans();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get("tab") as Tab) ? params.get("tab") : "overview") as Tab;
  const [dialog, setDialog] = useState<"approve" | "reject" | "disburse" | "collect" | "payoff" | "cancel" | null>(
    null,
  );

  const q = useQuery({ queryKey: ["loan", id, "today"], queryFn: () => api<Loan>(`/loans/${id}`) });
  const cancel = useMutation({
    mutationFn: () => api(`/loans/${id}/cancel`, { method: "POST", body: {} }),
    onSuccess: () => (void refresh(), setDialog(null), toast({ tone: "success", title: "Application cancelled" })),
    onError: (e) => (
      setDialog(null),
      toast({ tone: "danger", title: "Not cancelled", description: e instanceof ApiError ? e.message : undefined })
    ),
  });

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  const l = q.data;
  if (!l)
    return (
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold">Loan not found</h1>
        <Button asChild variant="secondary" className="mt-4">
          <Link to="/loans">Back to Loans</Link>
        </Button>
      </div>
    );

  const pos = l.position;
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });
  const pending = l.status === "APPLIED" || l.status === "APPROVED";
  const tabs = TABS.filter((t) => (t === "interest" || t === "payments" ? !!pos : true));

  return (
    <div className="space-y-5">
      <Link
        to="/loans"
        className="no-print inline-flex min-h-touch items-center gap-1 text-sm hover:underline md:min-h-0"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden /> Back to Loans
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-surface p-5">
        <div>
          <h1 className="text-xl font-semibold">{l.customer?.name}</h1>
          <p className="text-sm text-fg-muted">
            {l.code} · {l.product.name} · {ratePct(l.monthlyRateBp)} a month
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <LoanStatusBadge status={l.status} />
            {l.status === "ACTIVE" && pos && <DueBadge overdueDays={pos.oldestOverdueDays} />}
          </div>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          {l.status === "ACTIVE" && can("payment:create") && (
            <>
              <Button onClick={() => setDialog("collect")}>Collect payment</Button>
              <Button variant="secondary" onClick={() => setDialog("payoff")}>
                Pay off and close
              </Button>
            </>
          )}
          {l.status === "APPLIED" && can("loan:approve") && (
            <Button onClick={() => setDialog("approve")}>Approve</Button>
          )}
          {l.status === "APPROVED" && can("loan:disburse") && (
            <Button onClick={() => setDialog("disburse")}>Pay out</Button>
          )}
          {pending && can("loan:approve") && (
            <Button variant="secondary" onClick={() => setDialog("reject")}>
              Reject
            </Button>
          )}
          {pending && can("loan:edit") && (
            <Button variant="secondary" onClick={() => setDialog("cancel")}>
              Cancel application
            </Button>
          )}
        </div>
      </div>

      {pending && l.warnings.length > 0 && (
        <div role="status" className="rounded-md bg-warning-soft p-3 text-sm text-warning">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" aria-hidden /> Warnings on this application
          </p>
          <ul className="mt-1 list-disc pl-6">
            {l.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {pos ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Principal outstanding"
            value={inr(pos.principalOutstandingPaise)}
            hint={`of ${inr(l.principalPaise)} lent`}
          />
          <Stat
            label="Interest due now"
            value={inr(pos.interestDuePaise, true)}
            tone={pos.interestOverduePaise > 0 ? "text-danger" : undefined}
            hint={
              pos.interestAccruingPaise > 0
                ? `+ ${inr(pos.interestAccruingPaise, true)} building this month`
                : undefined
            }
          />
          <Stat
            label={l.status === "CLOSED" ? "Closed on" : "Next due date"}
            value={l.status === "CLOSED" ? fmtDate(l.closedOn) : fmtDate(pos.nextDueDate)}
          />
          <Stat
            label="Interest each month"
            value={inr(monthlyInterest(pos.principalOutstandingPaise, l.monthlyRateBp), true)}
            hint="on today's balance"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Loan amount" value={inr(l.principalPaise)} />
          <Stat label="Interest each month" value={inr(l.monthlyInterestPaise, true)} />
          <Stat label="Processing fee" value={inr(l.processingFeePaise, true)} />
          <Stat label="Cash to customer" value={inr(l.principalPaise - l.processingFeePaise, true)} />
        </div>
      )}

      <div
        role="tablist"
        aria-label="Loan sections"
        className="no-print flex gap-1 overflow-x-auto border-b border-border"
      >
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "min-h-touch whitespace-nowrap border-b-2 px-4 text-sm font-medium md:min-h-11",
              tab === t ? "border-primary text-primary" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {LABEL[t]}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab loan={l} />}
      {tab === "interest" && <InterestTab loan={l} />}
      {tab === "payments" && <PaymentsTab loan={l} />}
      {tab === "security" && <SecurityTab loan={l} />}

      {dialog === "approve" && <ApproveDialog loan={l} onClose={() => setDialog(null)} />}
      {dialog === "reject" && <RejectDialog loan={l} onClose={() => setDialog(null)} />}
      {dialog === "disburse" && <DisburseDialog loan={l} onClose={() => setDialog(null)} />}
      {(dialog === "collect" || dialog === "payoff") && (
        <CollectDialog
          loanId={l.id}
          startWith={dialog === "payoff" ? "payoff" : "due"}
          onClose={() => setDialog(null)}
        />
      )}
      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Cancel this application?"
        description="It will be closed and cannot be paid out. You can enter a new application for the customer."
        confirmLabel="Cancel application"
        destructive
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
    </div>
  );
}
