import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import { WIZARD_STEPS, type WizardStep } from "@jana/shared";
import { ApiError, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { Stepper } from "@/components/ui/stepper";
import { useToast } from "@/components/ui/toast";
import { STEP_COMPONENTS, STEP_LABELS } from "@/features/customers/wizard/steps";
import type { CustomerDetail, DuplicateMatch } from "@/features/customers/types";

function DuplicateList({ matches }: { matches: DuplicateMatch[] }) {
  return (
    <ul className="space-y-2">
      {matches.map((m) => (
        <li key={m.id} className="rounded-md border border-border p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">
              {m.name || "Unnamed"} <span className="text-fg-muted">({m.code})</span>
            </span>
            {m.status !== "DRAFT" && (
              <Link to={`/customers/${m.id}`} target="_blank" className="text-primary hover:underline">
                View
              </Link>
            )}
          </div>
          <p className="text-fg-muted">{m.reasons.join(" · ")}</p>
        </li>
      ))}
    </ul>
  );
}

export default function CustomerWizard() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [warning, setWarning] = useState<DuplicateMatch[]>([]);
  const [confirmDup, setConfirmDup] = useState<DuplicateMatch[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const q = useQuery({ queryKey: ["customer", id], queryFn: () => api<CustomerDetail>(`/customers/${id}`) });
  const customer = q.data;

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.isError || !customer) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold">Customer not found</h1>
        <Button asChild variant="secondary" className="mt-4">
          <Link to="/customers">Back to Customers</Link>
        </Button>
      </div>
    );
  }

  const requested = params.get("step") as WizardStep | null;
  const step: WizardStep = requested && WIZARD_STEPS.includes(requested) ? requested : customer.lastStep;
  const index = WIZARD_STEPS.indexOf(step);
  const isDraft = customer.status === "DRAFT";
  const percent = Math.round((customer.completedSteps.length / WIZARD_STEPS.length) * 100);
  const go = (s: WizardStep) => setParams({ step: s }, { replace: true });

  /** After basic details or KYC numbers are saved, warn early if this looks like an existing customer. */
  async function checkDuplicates(c: CustomerDetail) {
    try {
      const r = await api<{ matches: DuplicateMatch[] }>("/customers/duplicates/check", {
        method: "POST",
        body: { customerId: c.id },
      });
      setWarning(r.matches);
    } catch {
      /* advisory only */
    }
  }

  async function submit(acknowledge: boolean) {
    setSubmitting(true);
    try {
      const c = await api<CustomerDetail>(`/customers/${id}/submit`, {
        method: "POST",
        body: { acknowledgeDuplicates: acknowledge },
      });
      qc.setQueryData(["customer", id], c);
      void qc.invalidateQueries({ queryKey: ["customers"] });
      toast({ tone: "success", title: "Customer created", description: `${c.code} · ${c.name}` });
      navigate(`/customers/${id}`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === "DUPLICATE_SUSPECTED") {
        setConfirmDup((e as ApiError & { details?: unknown }).details ? [] : []);
        const res = await api<{ matches: DuplicateMatch[] }>("/customers/duplicates/check", {
          method: "POST",
          body: { customerId: id },
        });
        setConfirmDup(res.matches);
      } else if (e instanceof ApiError && e.code === "INCOMPLETE") {
        toast({
          tone: "danger",
          title: "Some steps are incomplete",
          description: "Finish every step and record consent.",
        });
      } else {
        toast({
          tone: "danger",
          title: "Could not create the customer",
          description: e instanceof ApiError ? e.message : undefined,
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const Step = STEP_COMPONENTS[step];
  const isLast = index === WIZARD_STEPS.length - 1;

  async function onNext(c: CustomerDetail) {
    if (step === "basic" || step === "kyc") await checkDuplicates(c);
    if (!isLast) return go(WIZARD_STEPS[index + 1]!);
    if (isDraft) await submit(false);
    else {
      toast({ tone: "success", title: "Changes saved" });
      navigate(`/customers/${id}`);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link
        to={isDraft ? "/customers" : `/customers/${id}`}
        className="inline-flex min-h-touch items-center gap-1 text-sm hover:underline md:min-h-0"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden /> Back to {isDraft ? "Customers" : "profile"}
      </Link>

      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{isDraft ? "New Customer Onboarding" : `Edit ${customer.name}`}</h1>
            <p className="text-sm text-fg-muted">
              Step {index + 1} of {WIZARD_STEPS.length} · {STEP_LABELS[step]} · {customer.code}
            </p>
          </div>
          <span className="tabular text-sm text-fg-muted">{percent}% complete</span>
        </div>
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Registration progress"
        >
          <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-4">
          <Stepper
            steps={WIZARD_STEPS.map((k) => ({ key: k, label: STEP_LABELS[k] }))}
            current={index}
            completed={customer.completedSteps}
            onStepClick={(i) => go(WIZARD_STEPS[i]!)}
          />
        </div>
      </div>

      {warning.length > 0 && (
        <div role="alert" className="rounded-lg border border-warning/40 bg-warning-soft p-4">
          <p className="mb-2 flex items-center gap-2 font-medium text-warning">
            <AlertTriangle className="h-4 w-4" aria-hidden /> This customer may already exist
          </p>
          <DuplicateList matches={warning} />
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface p-5">
        <Step // Keyed by step only: an upload updates the customer record, and that must not reset what has been typed.
          key={step}
          customer={customer}
          isFirst={index === 0}
          isLast={isLast}
          onNext={onNext}
          onBack={() => go(WIZARD_STEPS[Math.max(0, index - 1)]!)}
          onSaved={(c) => void checkDuplicates(c)}
        />
      </div>

      <Modal open={!!confirmDup} onOpenChange={(o) => !o && setConfirmDup(null)} title="Possible duplicate customer">
        <p className="mb-3 text-sm text-fg-muted">
          These existing customers match. Check them before creating another record.
        </p>
        {confirmDup && <DuplicateList matches={confirmDup} />}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setConfirmDup(null)}>
            Go back
          </Button>
          <Button
            loading={submitting}
            onClick={async () => {
              await submit(true);
              setConfirmDup(null);
            }}
          >
            Create anyway
          </Button>
        </div>
      </Modal>
    </div>
  );
}
