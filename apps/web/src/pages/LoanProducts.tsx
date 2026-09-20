import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Plus } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { RupeeInput } from "@/features/chits/ui";
import type { LoanProduct } from "@/features/loans/types";
import { inr, parseRatePct, ratePct } from "@/features/loans/ui";

const pctText = (bp: number) => String(bp / 100);

function ProductForm({ product, onClose }: { product: LoanProduct | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(product?.name ?? "");
  const [rate, setRate] = useState(product ? pctText(product.monthlyRateBp) : "2");
  const [minRate, setMinRate] = useState(product ? pctText(product.minRateBp) : "1");
  const [maxRate, setMaxRate] = useState(product ? pctText(product.maxRateBp) : "3");
  const [minAmt, setMinAmt] = useState<number | undefined>(product?.minAmountPaise ?? 1_000_00);
  const [maxAmt, setMaxAmt] = useState<number | undefined>(product?.maxAmountPaise ?? 10_00_000_00);
  const [feePct, setFeePct] = useState(product ? pctText(product.processingFeeBp) : "1");
  const [feeFlat, setFeeFlat] = useState<number | undefined>(product?.processingFeeFlatPaise ?? 0);
  const [active, setActive] = useState(product?.active ?? true);
  const [notes, setNotes] = useState(product?.notes ?? "");

  const body = {
    name,
    monthlyRateBp: parseRatePct(rate),
    minRateBp: parseRatePct(minRate),
    maxRateBp: parseRatePct(maxRate),
    minAmountPaise: minAmt,
    maxAmountPaise: maxAmt,
    processingFeeBp: parseRatePct(feePct) ?? 0,
    processingFeeFlatPaise: feeFlat ?? 0,
    active,
    notes: notes || undefined,
  };
  const valid = name.trim().length >= 2 && body.monthlyRateBp && body.minRateBp && body.maxRateBp && minAmt && maxAmt;

  const save = useMutation({
    mutationFn: () =>
      api<LoanProduct>(product ? `/loan-products/${product.id}` : "/loan-products", {
        method: product ? "PATCH" : "POST",
        body,
      }),
    onSuccess: () => (
      void qc.invalidateQueries({ queryKey: ["loan-products"] }),
      toast({ tone: "success", title: product ? "Product updated" : "Product created" }),
      onClose()
    ),
    onError: (e) =>
      toast({ tone: "danger", title: "Not saved", description: e instanceof ApiError ? e.message : undefined }),
  });

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={product ? "Edit loan product" : "New loan product"} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="pname" required>
            <Input id="pname" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Standard rate (% a month)" htmlFor="prate" required>
            <Input id="prate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
          <Field label="Lowest rate allowed (%)" htmlFor="pmin" required>
            <Input id="pmin" inputMode="decimal" value={minRate} onChange={(e) => setMinRate(e.target.value)} />
          </Field>
          <Field label="Highest rate allowed (%)" htmlFor="pmax" required>
            <Input id="pmax" inputMode="decimal" value={maxRate} onChange={(e) => setMaxRate(e.target.value)} />
          </Field>
          <Field label="Smallest loan (₹)" htmlFor="pmina" required>
            <RupeeInput id="pmina" defaultRupees={minAmt ? String(minAmt / 100) : ""} onPaise={setMinAmt} />
          </Field>
          <Field label="Largest loan (₹)" htmlFor="pmaxa" required>
            <RupeeInput id="pmaxa" defaultRupees={maxAmt ? String(maxAmt / 100) : ""} onPaise={setMaxAmt} />
          </Field>
          <Field label="Processing fee (% of loan)" htmlFor="pfee">
            <Input id="pfee" inputMode="decimal" value={feePct} onChange={(e) => setFeePct(e.target.value)} />
          </Field>
          <Field label="Plus a fixed fee (₹)" htmlFor="pflat">
            <RupeeInput id="pflat" defaultRupees={feeFlat ? String(feeFlat / 100) : ""} onPaise={setFeeFlat} />
          </Field>
        </div>
        <Field label="Notes" htmlFor="pnotes">
          <Textarea id="pnotes" rows={2} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <label className="flex min-h-touch items-center gap-2 text-sm md:min-h-0">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Available for new applications
        </label>
        <p className="text-xs text-fg-muted">
          Changing a product never changes loans already given: each loan keeps the rate and fee it was approved with.
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!valid}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function LoanProducts() {
  const [editing, setEditing] = useState<LoanProduct | null | "new">(null);
  const q = useQuery({
    queryKey: ["loan-products", "all"],
    queryFn: () => api<LoanProduct[]>("/loan-products", { query: { all: "true" } }),
  });
  return (
    <div className="space-y-5">
      <Link to="/loans" className="inline-flex min-h-touch items-center gap-1 text-sm hover:underline md:min-h-0">
        <ChevronLeft className="h-4 w-4" aria-hidden /> Back to Loans
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Loan products</h1>
          <p className="text-fg-muted">The standard rate, limits and fee for each kind of loan you give</p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" aria-hidden /> New product
        </Button>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !q.data?.length ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <p className="font-medium">No loan products yet</p>
          <p className="mt-1 text-sm text-fg-muted">
            Create one, for example “Personal loan, 2% a month”, before entering a loan.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs text-fg-muted">
              <tr>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Rate a month</th>
                <th className="px-3 py-2 text-right">Loan size</th>
                <th className="px-3 py-2">Fee</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2 font-medium">{p.name}</td>
                  <td className="tabular px-3 py-2">
                    {ratePct(p.monthlyRateBp)}
                    {p.minRateBp !== p.maxRateBp && (
                      <span className="text-fg-muted">
                        {" "}
                        ({ratePct(p.minRateBp)} to {ratePct(p.maxRateBp)})
                      </span>
                    )}
                  </td>
                  <td className="tabular px-3 py-2 text-right">
                    {inr(p.minAmountPaise)} to {inr(p.maxAmountPaise)}
                  </td>
                  <td className="tabular px-3 py-2">
                    {p.processingFeeBp ? ratePct(p.processingFeeBp) : ""}
                    {p.processingFeeBp && p.processingFeeFlatPaise ? " + " : ""}
                    {p.processingFeeFlatPaise ? inr(p.processingFeeFlatPaise) : ""}
                    {!p.processingFeeBp && !p.processingFeeFlatPaise ? "None" : ""}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge tone={p.active ? "success" : "neutral"}>
                      {p.active ? "Available" : "Not available"}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ProductForm product={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
