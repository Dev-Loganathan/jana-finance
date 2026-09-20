import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, Info, XCircle } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { CustomerPicker } from "@/features/chits/CustomerPicker";
import { RupeeInput } from "@/features/chits/ui";
import { KycBadge } from "@/features/customers/badges";
import type { LoanDetail, LoanPreview, LoanProduct } from "@/features/loans/types";
import { Card, inr, parseRatePct, ratePct } from "@/features/loans/ui";

interface Picked {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  kycStatus?: string;
}

function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function LoanNew() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  // undefined = not chosen yet, so a customer passed in the address (from their profile) is used; null = cleared.
  const [chosen, setChosen] = useState<Picked | null | undefined>(undefined);
  const [productChoice, setProductChoice] = useState("");
  const [principal, setPrincipal] = useState<number | undefined>();
  const [rateEdit, setRateEdit] = useState<string | undefined>();
  const [term, setTerm] = useState("");
  const [purpose, setPurpose] = useState("");
  const [fee, setFee] = useState<number | undefined>();
  const [gName, setGName] = useState("");
  const [gPhone, setGPhone] = useState("");
  const [gRelation, setGRelation] = useState("");
  const [notes, setNotes] = useState("");

  // Arrive from a customer's profile with them already chosen
  const preset = params.get("customerId");
  const presetCustomer = useQuery({
    queryKey: ["customer", preset],
    queryFn: () => api<Picked & { firstName?: string; lastName?: string }>(`/customers/${preset}`),
    enabled: !!preset && chosen === undefined,
  });
  const fromPreset: Picked | null = presetCustomer.data
    ? {
        id: presetCustomer.data.id,
        code: presetCustomer.data.code,
        name: presetCustomer.data.name ?? `${presetCustomer.data.firstName} ${presetCustomer.data.lastName}`,
        phone: presetCustomer.data.phone,
        kycStatus: presetCustomer.data.kycStatus,
      }
    : null;
  const customer = chosen === undefined ? fromPreset : chosen;
  const setCustomer = setChosen;

  const products = useQuery({ queryKey: ["loan-products"], queryFn: () => api<LoanProduct[]>("/loan-products") });
  // The first product is used until another is picked; the rate follows the product until it is typed over.
  const productId = productChoice || products.data?.[0]?.id || "";
  const product = products.data?.find((p) => p.id === productId);
  const rateText = rateEdit ?? (product ? String(product.monthlyRateBp / 100) : "");
  const setRateText = setRateEdit;

  const rateBp = parseRatePct(rateText);
  const ready = !!customer && !!product && !!principal && rateBp !== undefined;
  const wanted = useDebounced({ customerId: customer?.id, productId, principal, rateBp });
  const preview = useQuery({
    queryKey: ["loan-preview", wanted],
    queryFn: () =>
      api<LoanPreview>("/loans/preview", {
        query: {
          customerId: wanted.customerId,
          productId: wanted.productId,
          principalPaise: wanted.principal,
          monthlyRateBp: wanted.rateBp,
        },
      }),
    enabled: !!wanted.customerId && !!wanted.productId && !!wanted.principal && wanted.rateBp !== undefined,
  });
  const pv = preview.data;
  const finalFee = fee ?? pv?.processingFeePaise ?? 0;

  const problems: string[] = [];
  if (product && principal && (principal < product.minAmountPaise || principal > product.maxAmountPaise))
    problems.push(`This product allows ${inr(product.minAmountPaise)} to ${inr(product.maxAmountPaise)}`);
  if (product && rateBp !== undefined && (rateBp < product.minRateBp || rateBp > product.maxRateBp))
    problems.push(`This product allows ${ratePct(product.minRateBp)} to ${ratePct(product.maxRateBp)} a month`);
  if (rateText && rateBp === undefined) problems.push("Enter the rate as a percentage a month, like 2 or 1.5");
  if (principal && finalFee >= principal) problems.push("The processing fee must be less than the loan amount");

  const save = useMutation({
    mutationFn: () =>
      api<LoanDetail>("/loans", {
        method: "POST",
        body: {
          customerId: customer!.id,
          productId,
          principalPaise: principal,
          monthlyRateBp: rateBp,
          termMonths: term ? Number(term) : undefined,
          purpose: purpose || undefined,
          processingFeePaise: fee,
          notes: notes || undefined,
          guarantorName: gName || undefined,
          guarantorPhone: gPhone || undefined,
          guarantorRelation: gRelation || undefined,
        },
      }),
    onSuccess: (l) => (toast({ tone: "success", title: `Application ${l.code} saved` }), navigate(`/loans/${l.id}`)),
    onError: (e) =>
      toast({
        tone: "danger",
        title: "Could not save the application",
        description: e instanceof ApiError ? e.message : undefined,
      }),
  });

  const blocked = (pv?.blockers.length ?? 0) > 0 || problems.length > 0;

  return (
    <div className="space-y-5">
      <Link to="/loans" className="inline-flex min-h-touch items-center gap-1 text-sm hover:underline md:min-h-0">
        <ChevronLeft className="h-4 w-4" aria-hidden /> Back to Loans
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">New loan application</h1>
        <p className="text-fg-muted">A second person approves it, then it can be paid out.</p>
      </div>

      <form
        className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !blocked) save.mutate();
        }}
      >
        <div className="space-y-5">
          <Card title="Borrower">
            {customer ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface-muted p-3">
                <div>
                  <p className="font-medium">
                    {customer.name} <span className="text-fg-muted">({customer.code})</span>
                  </p>
                  <p className="text-sm text-fg-muted">{customer.phone}</p>
                </div>
                <div className="flex items-center gap-2">
                  {customer.kycStatus && <KycBadge status={customer.kycStatus as never} />}
                  <Button type="button" variant="secondary" onClick={() => setCustomer(null)}>
                    Change
                  </Button>
                </div>
              </div>
            ) : (
              <CustomerPicker
                isBlocked={(c) => c.watchStatus === "BLACKLIST"}
                onPick={(c) =>
                  setCustomer({ id: c.id, code: c.code, name: c.name, phone: c.phone, kycStatus: c.kycStatus })
                }
              />
            )}
          </Card>

          <Card title="Loan terms">
            {products.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : !products.data?.length ? (
              <p className="text-sm text-fg-muted">
                No loan product exists yet.{" "}
                <Link to="/loans/products" className="text-primary underline">
                  Create one first
                </Link>
                .
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Product" htmlFor="product" required>
                  <Select
                    id="product"
                    value={productId}
                    onChange={(e) => {
                      setProductChoice(e.target.value);
                      setRateEdit(undefined);
                      setFee(undefined);
                    }}
                  >
                    {products.data.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Loan amount (₹)"
                  htmlFor="amount"
                  required
                  hint={product ? `${inr(product.minAmountPaise)} to ${inr(product.maxAmountPaise)}` : undefined}
                >
                  <RupeeInput id="amount" onPaise={setPrincipal} />
                </Field>
                <Field
                  label="Interest rate (% a month)"
                  htmlFor="rate"
                  required
                  hint={
                    product && product.minRateBp !== product.maxRateBp
                      ? `Allowed ${ratePct(product.minRateBp)} to ${ratePct(product.maxRateBp)}`
                      : "Fixed for the life of the loan"
                  }
                >
                  <Input id="rate" inputMode="decimal" value={rateText} onChange={(e) => setRateText(e.target.value)} />
                </Field>
                <Field
                  label="Expected term (months)"
                  htmlFor="term"
                  hint="Optional. Principal can be repaid at any time."
                >
                  <Input
                    id="term"
                    inputMode="numeric"
                    value={term}
                    onChange={(e) => setTerm(e.target.value.replace(/\D/g, ""))}
                    maxLength={3}
                  />
                </Field>
                <Field
                  label="Processing fee (₹)"
                  htmlFor="fee"
                  hint="Deducted from the payout. Leave blank for the product's fee."
                >
                  <RupeeInput
                    id="fee"
                    onPaise={setFee}
                    defaultRupees=""
                    placeholder={pv ? String(pv.processingFeePaise / 100) : ""}
                  />
                </Field>
                <Field label="Purpose" htmlFor="purpose">
                  <Input id="purpose" value={purpose} maxLength={200} onChange={(e) => setPurpose(e.target.value)} />
                </Field>
              </div>
            )}
          </Card>

          <Card title="Guarantor (optional)">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Name" htmlFor="gname">
                <Input id="gname" value={gName} maxLength={80} onChange={(e) => setGName(e.target.value)} />
              </Field>
              <Field label="Mobile" htmlFor="gphone">
                <Input
                  id="gphone"
                  inputMode="numeric"
                  value={gPhone}
                  maxLength={10}
                  onChange={(e) => setGPhone(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
              <Field label="Relation" htmlFor="grel">
                <Input id="grel" value={gRelation} maxLength={40} onChange={(e) => setGRelation(e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card title="Notes">
            <Field label="Anything the approver should know" htmlFor="notes">
              <Textarea id="notes" rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <p className="mt-2 text-xs text-fg-muted">You can add collateral and photos on the next page.</p>
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card title="What this costs">
            {!ready ? (
              <p className="text-sm text-fg-muted">
                Choose the customer, the product and an amount to see the figures.
              </p>
            ) : preview.isLoading || !pv ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs text-fg-muted">Interest each month</dt>
                  <dd className="tabular text-2xl font-semibold">{inr(pv.monthlyInterestPaise, true)}</dd>
                  <dd className="text-xs text-fg-muted">
                    {ratePct(rateBp!)} a month, about{" "}
                    {pv.yearlyPercent === Math.round(pv.yearlyPercent) ? pv.yearlyPercent : pv.yearlyPercent.toFixed(2)}
                    % a year, on the balance outstanding
                  </dd>
                </div>
                <div className="flex justify-between border-t border-border pt-3">
                  <dt>Loan amount</dt>
                  <dd className="tabular">{inr(principal, true)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Processing fee</dt>
                  <dd className="tabular">− {inr(finalFee, true)}</dd>
                </div>
                <div className="flex justify-between border-t border-border pt-3 font-semibold">
                  <dt>Cash paid to the customer</dt>
                  <dd className="tabular">{inr((principal ?? 0) - finalFee, true)}</dd>
                </div>
              </dl>
            )}
          </Card>

          {pv?.blockers.length || pv?.warnings.length || problems.length ? (
            <Card title="Check before saving">
              <ul className="space-y-2 text-sm">
                {problems.map((m) => (
                  <li key={m} className="flex gap-2 text-danger">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>{m}</span>
                  </li>
                ))}
                {pv?.blockers.map((m) => (
                  <li key={m} className="flex gap-2 text-danger">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>{m}</span>
                  </li>
                ))}
                {pv?.warnings.map((m) => (
                  <li key={m} className="flex gap-2 text-warning">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
              {!!pv?.warnings.length && !pv.blockers.length && (
                <p className="mt-3 flex gap-2 text-xs text-fg-muted">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  Warnings do not stop the application. The approver must give a reason to approve it anyway.
                </p>
              )}
            </Card>
          ) : null}

          <Button type="submit" size="touch" className="w-full" loading={save.isPending} disabled={!ready || blocked}>
            Save application
          </Button>
        </aside>
      </form>
    </div>
  );
}
