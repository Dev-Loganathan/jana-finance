import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { CHIT_TYPES, bpOf, computeAuction, createChitGroupSchema, validateChitConfig } from "@jana/shared";
import { ApiError, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import type { ChitGroupSummary } from "@/features/chits/types";
import { RupeeInput, TYPE_LABEL, inr } from "@/features/chits/ui";

const today = () => new Date().toISOString().slice(0, 10);

/** Create form. The preview uses the same maths as the server, so what you see is what the auction will calculate. */
export default function ChitNew() {
  const navigate = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({
    name: "",
    type: "AUCTION" as (typeof CHIT_TYPES)[number],
    chitValue: (500_000 * 100) as number | undefined,
    members: "20",
    subscription: undefined as number | undefined,
    commission: "5",
    maxBid: "40",
    startDate: today(),
    auctionDay: "10",
    dueDays: "5",
    penalty: "0",
    grace: "3",
    fee: undefined as number | undefined,
    notes: "",
  });
  const [errors, setErrors] = useState<string[]>([]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const members = Number(f.members) || 0;
  // Subscription is derived from value / members unless the user overrides it.
  const derivedSub = f.chitValue && members ? Math.round(f.chitValue / members) : undefined;
  const subscription = f.subscription ?? derivedSub;
  const commissionBp = Math.round((Number(f.commission) || 0) * 100);
  const maxBidBp = Math.round((Number(f.maxBid) || 0) * 100);

  const body = useMemo(
    () => ({
      name: f.name,
      type: f.type,
      chitValuePaise: f.chitValue ?? 0,
      members,
      durationMonths: members,
      monthlySubscriptionPaise: subscription ?? 0,
      commissionBp,
      maxBidBp,
      startDate: f.startDate,
      auctionDay: Number(f.auctionDay),
      dueDaysAfterAuction: Number(f.dueDays),
      penaltyRateBp: Math.round((Number(f.penalty) || 0) * 100),
      penaltyGraceDays: Number(f.grace),
      registrationFeePaise: f.fee ?? 0,
      notes: f.notes || undefined,
    }),
    [f, members, subscription, commissionBp, maxBidBp],
  );

  const problems = useMemo(() => {
    const cfg = {
      chitValuePaise: body.chitValuePaise,
      members,
      durationMonths: members,
      monthlySubscriptionPaise: body.monthlySubscriptionPaise,
      commissionBp,
      minBidBp: commissionBp,
      maxBidBp,
    };
    return body.chitValuePaise > 0 && members > 1 ? validateChitConfig(cfg, f.type) : [];
  }, [body, members, commissionBp, maxBidBp, f.type]);

  const preview = useMemo(() => {
    if (problems.length || !body.chitValuePaise || members < 2) return null;
    const commission = bpOf(body.chitValuePaise, commissionBp);
    const example = f.type === "AUCTION" ? Math.max(commission, bpOf(body.chitValuePaise, 2000)) : null;
    return {
      commission,
      max: bpOf(body.chitValuePaise, maxBidBp),
      example: computeAuction({ chitValuePaise: body.chitValuePaise, members, commissionBp, discountPaise: example }),
    };
  }, [problems, body.chitValuePaise, members, commissionBp, maxBidBp, f.type]);

  const create = useMutation({
    mutationFn: () => api<ChitGroupSummary>("/chits", { method: "POST", body }),
    onSuccess: (g) => {
      toast({ tone: "success", title: "Chit group created", description: `${g.code} · ${g.name}` });
      navigate(`/chits/${g.id}`);
    },
    onError: (e) => {
      const d =
        e instanceof ApiError
          ? (e.details as { fieldErrors?: Record<string, string[]>; formErrors?: string[] } | undefined)
          : undefined;
      setErrors(
        [
          ...(d?.formErrors ?? []),
          ...Object.entries(d?.fieldErrors ?? {}).flatMap(([k, v]) => v.map((m) => `${k}: ${m}`)),
        ].concat(e instanceof ApiError && !d ? [e.message] : []),
      );
    },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link to="/chits" className="inline-flex min-h-touch items-center gap-1 text-sm hover:underline md:min-h-0">
        <ChevronLeft className="h-4 w-4" aria-hidden /> Back to Chit Funds
      </Link>
      <h1 className="text-2xl font-semibold">New chit group</h1>

      <form
        noValidate
        className="space-y-6 rounded-lg border border-border bg-surface p-5"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = createChitGroupSchema.safeParse(body);
          if (!parsed.success)
            return setErrors([
              ...new Set(parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`)),
            ]);
          setErrors([]);
          create.mutate();
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Group name" htmlFor="name" required>
            <Input
              id="name"
              value={f.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Anna Nagar 5 Lakh - Jan"
            />
          </Field>
          <Field
            label="Chit type"
            htmlFor="type"
            hint={
              f.type === "AUCTION"
                ? "Members bid a discount; the highest discount wins the month"
                : f.type === "LOTTERY"
                  ? "The winner is drawn at random from eligible members"
                  : "Winners follow a fixed order"
            }
          >
            <Select id="type" value={f.type} onChange={(e) => set("type", e.target.value as typeof f.type)}>
              {CHIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Chit value (₹)" htmlFor="value" required>
            <RupeeInput id="value" defaultRupees="500000" onPaise={(p) => set("chitValue", p)} />
          </Field>
          <Field
            label="Members / tickets"
            htmlFor="members"
            required
            hint="One auction per month, so the duration in months equals the number of members"
          >
            <Input
              id="members"
              inputMode="numeric"
              value={f.members}
              onChange={(e) => set("members", e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Field
            label="Monthly subscription (₹)"
            htmlFor="sub"
            hint={derivedSub ? `Chit value ÷ members = ${inr(derivedSub)}` : undefined}
          >
            <RupeeInput
              key={derivedSub}
              id="sub"
              defaultRupees={derivedSub ? String(derivedSub / 100) : ""}
              onPaise={(p) => set("subscription", p)}
            />
          </Field>
          <Field
            label="Foreman commission (%)"
            htmlFor="commission"
            required
            hint="Default 5%. Confirm the legal cap for your state."
          >
            <Input
              id="commission"
              inputMode="decimal"
              value={f.commission}
              onChange={(e) => set("commission", e.target.value)}
            />
          </Field>
          {f.type === "AUCTION" && (
            <Field label="Maximum bid (% of chit value)" htmlFor="maxbid" hint="The minimum bid equals the commission">
              <Input id="maxbid" inputMode="decimal" value={f.maxBid} onChange={(e) => set("maxBid", e.target.value)} />
            </Field>
          )}
          <Field label="First month" htmlFor="start" required hint="Month 1 is the month of this date">
            <Input id="start" type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </Field>
          <Field
            label="Auction day of the month"
            htmlFor="day"
            required
            hint="Day 29-31 falls on the last day of shorter months"
          >
            <Input
              id="day"
              inputMode="numeric"
              value={f.auctionDay}
              onChange={(e) => set("auctionDay", e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Field label="Installment due (days after auction)" htmlFor="due">
            <Input
              id="due"
              inputMode="numeric"
              value={f.dueDays}
              onChange={(e) => set("dueDays", e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Field
            label="Late penalty (% per month)"
            htmlFor="penalty"
            hint="0 for none. Charged daily after the grace days."
          >
            <Input
              id="penalty"
              inputMode="decimal"
              value={f.penalty}
              onChange={(e) => set("penalty", e.target.value)}
            />
          </Field>
          <Field label="Grace days" htmlFor="grace">
            <Input
              id="grace"
              inputMode="numeric"
              value={f.grace}
              onChange={(e) => set("grace", e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Field label="Registration / document fee (₹)" htmlFor="fee">
            <RupeeInput id="fee" onPaise={(p) => set("fee", p)} />
          </Field>
        </div>
        <Field label="Notes" htmlFor="notes">
          <Textarea id="notes" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>

        {problems.length > 0 && (
          <ul role="alert" className="list-disc space-y-1 rounded-md bg-warning-soft p-3 pl-7 text-sm text-warning">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {preview && (
          <div className="rounded-md bg-surface-muted p-4 text-sm" aria-live="polite">
            <p className="mb-2 font-medium">How this group works</p>
            <ul className="space-y-1 text-fg-muted">
              <li>
                Foreman commission: <strong className="tabular text-fg">{inr(preview.commission)}</strong> every month
              </li>
              {f.type === "AUCTION" && (
                <li>
                  Bids allowed: <strong className="tabular text-fg">{inr(preview.commission)}</strong> to{" "}
                  <strong className="tabular text-fg">{inr(preview.max)}</strong>
                </li>
              )}
              <li>
                Example month{f.type === "AUCTION" ? ` with a ${inr(preview.example.discountPaise)} discount` : ""}:
                winner receives <strong className="tabular text-fg">{inr(preview.example.prizePaise)}</strong>, each
                member pays <strong className="tabular text-fg">{inr(preview.example.netInstallmentPaise)}</strong>{" "}
                (dividend {inr(preview.example.dividendPerMemberPaise)})
              </li>
            </ul>
          </div>
        )}
        {errors.length > 0 && (
          <ul role="alert" className="list-disc space-y-1 rounded-md bg-danger-soft p-3 pl-7 text-sm text-danger">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate("/chits")}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending} disabled={problems.length > 0}>
            Create group
          </Button>
        </div>
      </form>
    </div>
  );
}
