import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Camera, ImageIcon, Trash2 } from "lucide-react";
import { COLLATERAL_KINDS } from "@jana/shared";
import { ApiError, api, upload } from "@/lib/api";
import { useCan } from "@/auth/permissions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { RupeeInput } from "@/features/chits/ui";
import { FileViewer } from "@/features/customers/FileViewer";
import { compressImage } from "@/features/customers/image";
import { KycBadge } from "@/features/customers/badges";
import { ReasonDialog, ReceiptModal, useRefreshLoans } from "./dialogs";
import type { Collateral, LoanDetail } from "./types";
import { Card, fmtDate, inr, ratePct } from "./ui";

const label = (s: string) =>
  s
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2 text-sm last:border-0">
      <dt className="text-fg-muted">{k}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export function OverviewTab({ loan }: { loan: LoanDetail }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Terms">
        <dl>
          <Row k="Product">{loan.product.name}</Row>
          <Row k="Loan amount">
            <span className="tabular">{inr(loan.principalPaise, true)}</span>
          </Row>
          <Row k="Interest">
            {ratePct(loan.monthlyRateBp)} a month (about {loan.yearlyPercent}% a year), fixed
          </Row>
          <Row k="Interest each month at full balance">
            <span className="tabular">{inr(loan.monthlyInterestPaise, true)}</span>
          </Row>
          <Row k="Processing fee">
            <span className="tabular">{inr(loan.processingFeePaise, true)}</span>
          </Row>
          <Row k="Expected term">{loan.termMonths ? `${loan.termMonths} months` : "Open: repay any time"}</Row>
          <Row k="Purpose">{loan.purpose ?? "-"}</Row>
          <Row k="Paid out">
            {loan.disbursedOn ? `${fmtDate(loan.disbursedOn)} (${label(loan.disbursalMode ?? "")})` : "Not yet"}
          </Row>
          {loan.closedOn && <Row k="Closed on">{fmtDate(loan.closedOn)}</Row>}
        </dl>
      </Card>
      <div className="space-y-5">
        <Card title="Borrower">
          {loan.customer ? (
            <dl>
              <Row k="Customer">
                <Link to={`/customers/${loan.customer.id}`} className="font-medium text-primary hover:underline">
                  {loan.customer.name}
                </Link>{" "}
                <span className="text-fg-muted">({loan.customer.code})</span>
              </Row>
              <Row k="Mobile">{loan.customer.phone ?? "-"}</Row>
              <Row k="KYC">
                <KycBadge status={loan.customer.kycStatus as never} />
              </Row>
              <Row k="CIBIL">{loan.customer.cibilScore ?? "-"}</Row>
            </dl>
          ) : null}
          {loan.guarantor && (
            <dl className="mt-3 border-t border-border pt-3">
              <Row k="Guarantor">{loan.guarantor.name}</Row>
              <Row k="Guarantor mobile">{loan.guarantor.phone ?? "-"}</Row>
              <Row k="Relation">{loan.guarantor.relation ?? "-"}</Row>
            </dl>
          )}
        </Card>
        <Card title="Who did what">
          <dl>
            <Row k="Application entered by">{loan.appliedBy ?? "-"}</Row>
            <Row k="Approved by">
              {loan.approvedBy
                ? `${loan.approvedBy}${loan.approvedAt ? `, ${fmtDate(loan.approvedAt.slice(0, 10))}` : ""}`
                : "-"}
            </Row>
            <Row k="Paid out by">{loan.disbursedBy ?? "-"}</Row>
            {loan.overrideReason && <Row k="Approved despite warnings">{loan.overrideReason}</Row>}
            {loan.rejectionReason && <Row k="Rejected because">{loan.rejectionReason}</Row>}
            {loan.notes && <Row k="Notes">{loan.notes}</Row>}
          </dl>
        </Card>
      </div>
    </div>
  );
}

export function InterestTab({ loan }: { loan: LoanDetail }) {
  const pos = loan.position;
  if (!pos) return <p className="text-sm text-fg-muted">Interest starts once the loan is paid out.</p>;
  const day = loan.disbursedOn ? Number(loan.disbursedOn.slice(8, 10)) : null;
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">
        Interest is {ratePct(loan.monthlyRateBp)} a month on the balance outstanding each day. A month's interest is due
        on the {day}th of the next month. Paying principal lowers the interest from that day.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs text-fg-muted">
            <tr>
              <th className="px-3 py-2">Month</th>
              <th className="px-3 py-2">Period</th>
              <th className="px-3 py-2 text-right">Interest</th>
              <th className="px-3 py-2 text-right">Paid</th>
              <th className="px-3 py-2 text-right">Balance</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[...pos.cycles].reverse().map((c) => (
              <tr key={c.seq}>
                <td className="tabular px-3 py-2">{c.seq}</td>
                <td className="px-3 py-2 text-fg-muted">
                  {fmtDate(c.periodStart)} to {fmtDate(c.dueDate)}
                </td>
                <td className="tabular px-3 py-2 text-right">{inr(c.accruedPaise, true)}</td>
                <td className="tabular px-3 py-2 text-right">{inr(c.paidPaise, true)}</td>
                <td className="tabular px-3 py-2 text-right font-medium">{inr(c.outstandingPaise, true)}</td>
                <td className="px-3 py-2">
                  {!c.complete ? (
                    <StatusBadge tone="info">Building, due {fmtDate(c.dueDate)}</StatusBadge>
                  ) : c.outstandingPaise === 0 ? (
                    <StatusBadge tone="success">Paid</StatusBadge>
                  ) : c.overdueDays > 0 ? (
                    <StatusBadge tone="danger">{c.overdueDays} days overdue</StatusBadge>
                  ) : (
                    <StatusBadge tone="warning">Due today</StatusBadge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PaymentsTab({ loan }: { loan: LoanDetail }) {
  const can = useCan();
  const toast = useToast();
  const refresh = useRefreshLoans();
  const [viewing, setViewing] = useState<string | null>(null);
  const [reversing, setReversing] = useState<string | null>(null);
  const latest = loan.payments.find((p) => p.status === "POSTED")?.id;
  const reverse = useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      api(`/loans/payments/${v.id}/reverse`, { method: "POST", body: { reason: v.reason } }),
    onSuccess: () => (void refresh(), setReversing(null), toast({ tone: "success", title: "Receipt reversed" })),
    onError: (e) =>
      toast({ tone: "danger", title: "Not reversed", description: e instanceof ApiError ? e.message : undefined }),
  });
  if (!loan.payments.length) return <p className="text-sm text-fg-muted">No payments yet.</p>;
  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs text-fg-muted">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Receipt</th>
              <th className="px-3 py-2 text-right">Interest</th>
              <th className="px-3 py-2 text-right">Principal</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Mode</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loan.payments.map((p) => (
              <tr key={p.id} className={p.status === "REVERSED" ? "text-fg-muted line-through" : ""}>
                <td className="px-3 py-2">{fmtDate(p.paidOn)}</td>
                <td className="tabular px-3 py-2">
                  {p.receiptNo} {p.status === "REVERSED" && <StatusBadge tone="danger">Reversed</StatusBadge>}
                </td>
                <td className="tabular px-3 py-2 text-right">{inr(p.interestPaise, true)}</td>
                <td className="tabular px-3 py-2 text-right">{inr(p.principalPaise, true)}</td>
                <td className="tabular px-3 py-2 text-right font-medium">{inr(p.amountPaise, true)}</td>
                <td className="px-3 py-2">{label(p.mode)}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1 no-underline">
                    <Button size="sm" variant="secondary" onClick={() => setViewing(p.id)}>
                      Receipt
                    </Button>
                    {can("payment:reverse") && p.id === latest && (
                      <Button size="sm" variant="secondary" onClick={() => setReversing(p.id)}>
                        Reverse
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-fg-muted">Only the latest receipt can be reversed. Reverse newer ones first.</p>
      {viewing && <ReceiptModal paymentId={viewing} onClose={() => setViewing(null)} />}
      {reversing && (
        <ReasonDialog
          title="Reverse this receipt"
          intro="Use this for a payment recorded by mistake or a cheque that bounced. The money entry is cancelled with a matching reversal, never deleted."
          confirmLabel="Reverse receipt"
          loading={reverse.isPending}
          onSubmit={(reason) => reverse.mutate({ id: reversing, reason })}
          onClose={() => setReversing(null)}
        />
      )}
    </>
  );
}

function CollateralItem({ loan, item }: { loan: LoanDetail; item: Collateral }) {
  const can = useCan();
  const toast = useToast();
  const refresh = useRefreshLoans();
  const input = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<Collateral["files"][number] | null>(null);
  const editable = can("loan:edit");
  const fail = (title: string) => (e: unknown) =>
    toast({ tone: "danger", title, description: e instanceof ApiError ? e.message : undefined });
  const send = useMutation({
    mutationFn: async (f: File) => {
      const form = new FormData();
      form.append("label", "photo");
      form.append("file", await compressImage(f));
      return upload(`/loans/${loan.id}/collateral/${item.id}/photos`, form);
    },
    onSuccess: () => void refresh(),
    onError: fail("Photo not added"),
  });
  const dropPhoto = useMutation({
    mutationFn: (fileId: string) => api(`/loans/${loan.id}/photos/${fileId}`, { method: "DELETE" }),
    onSuccess: () => void refresh(),
    onError: fail("Could not remove"),
  });
  const release = useMutation({
    mutationFn: () => api(`/loans/${loan.id}/collateral/${item.id}/release`, { method: "POST", body: {} }),
    onSuccess: () => (void refresh(), toast({ tone: "success", title: "Marked as handed back" })),
    onError: fail("Not released"),
  });
  const remove = useMutation({
    mutationFn: () => api(`/loans/${loan.id}/collateral/${item.id}`, { method: "DELETE" }),
    onSuccess: () => void refresh(),
    onError: fail("Could not remove"),
  });
  const disbursed = loan.status === "ACTIVE" || loan.status === "CLOSED";
  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            {label(item.kind)}: {item.description}
          </p>
          <p className="text-sm text-fg-muted">
            <span className="tabular">{inr(item.estimatedValuePaise, true)}</span> estimated
            {item.reference ? ` · ${item.reference}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {item.status === "RELEASED" ? (
            <StatusBadge tone="neutral">
              Handed back {item.releasedAt ? fmtDate(item.releasedAt.slice(0, 10)) : ""}
            </StatusBadge>
          ) : (
            <StatusBadge tone="info">Held by us</StatusBadge>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {item.files.map((f) => (
          <span key={f.id} className="inline-flex items-center overflow-hidden rounded-md border border-border">
            <button
              type="button"
              className="flex min-h-touch items-center gap-1 px-2 text-sm hover:bg-surface-muted md:min-h-8"
              onClick={() => setViewing(f)}
            >
              <ImageIcon className="h-4 w-4" aria-hidden /> {f.label || "Photo"}
            </button>
            {editable && (
              <button
                type="button"
                aria-label={`Remove ${f.label || "photo"}`}
                className="min-h-touch border-l border-border px-2 hover:bg-danger-soft hover:text-danger md:min-h-8"
                onClick={() => dropPhoto.mutate(f.id)}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            )}
          </span>
        ))}
        {editable && item.status === "HELD" && (
          <>
            <input
              ref={input}
              type="file"
              accept="image/*,application/pdf"
              className="sr-only"
              aria-label="Add a photo"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) send.mutate(f);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              loading={send.isPending}
              onClick={() => input.current?.click()}
            >
              <Camera className="h-4 w-4" aria-hidden /> Add photo
            </Button>
          </>
        )}
        {editable && item.status === "HELD" && loan.status !== "ACTIVE" && !disbursed && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Remove item
          </Button>
        )}
        {editable && item.status === "HELD" && loan.status === "CLOSED" && (
          <Button type="button" size="sm" loading={release.isPending} onClick={() => release.mutate()}>
            Hand back to customer
          </Button>
        )}
      </div>
      <FileViewer
        file={viewing && { ...viewing, sizeBytes: 0, originalName: viewing.label || "Photo" }}
        onClose={() => setViewing(null)}
        linkPath={(id) => `/loans/files/${id}/url`}
      />
    </li>
  );
}

export function SecurityTab({ loan }: { loan: LoanDetail }) {
  const can = useCan();
  const toast = useToast();
  const refresh = useRefreshLoans();
  const [kind, setKind] = useState<string>("GOLD");
  const [description, setDescription] = useState("");
  const [value, setValue] = useState<number | undefined>();
  const [reference, setReference] = useState("");
  const add = useMutation({
    mutationFn: () =>
      api(`/loans/${loan.id}/collateral`, {
        method: "POST",
        body: { kind, description, estimatedValuePaise: value ?? 0, reference: reference || undefined },
      }),
    onSuccess: () => (
      void refresh(),
      setDescription(""),
      setReference(""),
      setValue(undefined),
      toast({ tone: "success", title: "Security recorded" })
    ),
    onError: (e) =>
      toast({ tone: "danger", title: "Not added", description: e instanceof ApiError ? e.message : undefined }),
  });
  const held = loan.collaterals.filter((c) => c.status === "HELD").reduce((s, c) => s + c.estimatedValuePaise, 0);
  const open = loan.status !== "REJECTED" && loan.status !== "CANCELLED";
  return (
    <div className="space-y-5">
      {loan.collaterals.length > 0 ? (
        <>
          <p className="text-sm text-fg-muted">
            Held against this loan: <span className="tabular font-semibold text-fg">{inr(held, true)}</span> estimated
            value
            {loan.position && loan.position.principalOutstandingPaise > 0 && (
              <>
                {" "}
                against{" "}
                <span className="tabular font-semibold text-fg">
                  {inr(loan.position.principalOutstandingPaise)}
                </span>{" "}
                outstanding
              </>
            )}
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {loan.collaterals.map((c) => (
              <CollateralItem key={c.id} loan={loan} item={c} />
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-fg-muted">No security recorded for this loan.</p>
      )}
      {can("loan:edit") && open && (
        <Card title="Add security">
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <Field label="Kind" htmlFor="ckind">
              <Select id="ckind" value={kind} onChange={(e) => setKind(e.target.value)}>
                {COLLATERAL_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {label(k)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Description" htmlFor="cdesc" required hint="For example: Gold chain 20 g, 22 carat">
              <Input id="cdesc" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field label="Estimated value (₹)" htmlFor="cval">
              <RupeeInput key={add.isSuccess ? String(add.submittedAt) : "v"} id="cval" onPaise={setValue} />
            </Field>
            <Field label="Reference (receipt or cheque no.)" htmlFor="cref">
              <Input id="cref" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" loading={add.isPending} disabled={description.trim().length < 2}>
                Add
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
