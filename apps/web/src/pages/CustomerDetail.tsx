import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Eye, Pencil, ShieldCheck, ShieldX, Trash2 } from "lucide-react";
import { KYC_REQUIRED_DEFAULT, formatINR, type KycDocType, type Paged } from "@jana/shared";
import { ApiError, api, apiUrl } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCan } from "@/auth/permissions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { PermissionGate } from "@/components/ui/permission-gate";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { Avatar, CATEGORY_LABEL, CibilScore, KycBadge, RiskBadge, WatchBadge } from "@/features/customers/badges";
import { NotesTab } from "@/features/customers/NotesTab";
import { ProfileFlags, WatchBanner } from "@/features/customers/ProfileFlags";
import { FileViewer } from "@/features/customers/FileViewer";
import { Masked } from "@/features/customers/Reveal";
import type { CustomerDetail as Customer, CustomerFileInfo, KycDocumentInfo } from "@/features/customers/types";
import { humanize } from "@/features/customers/wizard/fields";
import type { LoanListItem } from "@/features/loans/types";
import { Card as ActionCard, LoanStatusBadge, inr as loanInr } from "@/features/loans/ui";

const DOC_LABEL: Record<KycDocType, string> = {
  AADHAAR: "Aadhaar",
  PAN: "PAN",
  VOTER_ID: "Voter ID",
  DRIVING_LICENCE: "Driving licence",
  PASSPORT: "Passport",
  PHOTO: "Photo",
  SIGNATURE: "Signature",
  ADDRESS_PROOF: "Address proof",
  INCOME_PROOF: "Income proof",
  BANK_STATEMENT: "Bank statement",
  OTHER: "Additional document",
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-fg-muted">{k}</dt>
          <dd className="mt-0.5 break-words">{v || <span className="text-fg-muted">-</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function Photo({ customer }: { customer: Customer }) {
  const can = useCan();
  const file = customer.documents?.find((d) => d.type === "PHOTO")?.files[0];
  const link = useQuery({
    queryKey: ["photo-url", file?.id],
    queryFn: () => api<{ url: string }>(`/files/${file!.id}/url`),
    enabled: !!file && can("kyc:view"),
    staleTime: 30_000,
  });
  return <Avatar name={customer.name} url={link.data ? apiUrl(link.data.url) : null} size={64} />;
}

function CustomerLoans({ customerId, active }: { customerId: string; active: boolean }) {
  const can = useCan();
  const q = useQuery({
    queryKey: ["loans", "by-customer", customerId],
    queryFn: () => api<Paged<LoanListItem>>("/loans", { query: { customerId, pageSize: 50 } }),
    enabled: can("loan:view"),
  });
  if (!can("loan:view")) return null;
  const newLoan = can("loan:create") && active;
  if (!q.data?.items.length && !newLoan) return null;
  return (
    <ActionCard
      title="Loans"
      action={
        newLoan ? (
          <Button asChild size="sm" variant="secondary">
            <Link to={`/loans/new?customerId=${customerId}`}>New loan</Link>
          </Button>
        ) : undefined
      }
    >
      {q.data?.items.length ? (
        <ul className="divide-y divide-border text-sm">
          {q.data.items.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link to={`/loans/${l.id}`} className="font-medium hover:underline">
                {l.code} · {loanInr(l.principalPaise)} at {l.monthlyRateBp / 100}% a month
              </Link>
              <span className="flex items-center gap-2">
                {l.status === "ACTIVE" && (l.interestOverduePaise ?? 0) > 0 && (
                  <span className="tabular text-danger">{loanInr(l.interestOverduePaise)} overdue</span>
                )}
                <LoanStatusBadge status={l.status} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">No loans yet.</p>
      )}
    </ActionCard>
  );
}

function ChitMemberships({ customerId }: { customerId: string }) {
  const can = useCan();
  const q = useQuery({
    queryKey: ["chit-by-customer", customerId],
    queryFn: () =>
      api<
        {
          ticketId: string;
          number: number;
          prized: boolean;
          group: { id: string; code: string; name: string; status: string };
          outstandingPaise: number;
          advancePaise: number;
        }[]
      >(`/chits/by-customer/${customerId}`),
    enabled: can("chit:view"),
  });
  if (!can("chit:view") || !q.data?.length) return null;
  return (
    <Card title="Chit fund memberships">
      <ul className="divide-y divide-border text-sm">
        {q.data.map((m) => (
          <li key={m.ticketId} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <Link to={`/chits/tickets/${m.ticketId}`} className="font-medium hover:underline">
              {m.group.name} · ticket {m.number}
            </Link>
            <span className="tabular text-fg-muted">
              {m.prized ? "Prize won · " : ""}
              {m.outstandingPaise > 0 ? `${formatINR(m.outstandingPaise, { decimals: false })} due` : "No dues"}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Overview({ c }: { c: Customer }) {
  const e = c.evaluation;
  const emp = c.employment;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Personal">
        <Rows
          rows={[
            ["Gender", humanize(c.gender ?? "")],
            ["Date of birth", c.dob],
            ["Mobile", c.phone],
            ["Alternate", c.altPhone],
            ["Email", c.email],
            ["Marital status", humanize(c.maritalStatus ?? "")],
          ]}
        />
      </Card>
      <Card title="Address">
        <Rows
          rows={[
            ["Current", c.address.currentAddress],
            ["Permanent", c.address.permanentAddress],
            ["District / State", [c.address.district, c.address.state].filter(Boolean).join(", ")],
            ["Pincode", c.address.pincode],
            ["Landmark", c.address.landmark],
            ["Residence", humanize(c.address.residenceType ?? "")],
          ]}
        />
      </Card>
      <Card title="Employment and income">
        <Rows
          rows={[
            ["Occupation", humanize(emp.occupationType ?? "")],
            ["Company", emp.companyName],
            ["Designation", emp.designation],
            ["Experience", emp.workExperience],
            [
              "Monthly income",
              <span key="i" className="tabular">
                {formatINR(emp.monthlyIncomePaise, { decimals: false })}
              </span>,
            ],
            [
              "Additional income",
              <span key="a" className="tabular">
                {formatINR(emp.additionalIncomePaise, { decimals: false })}
              </span>,
            ],
            ["Business", emp.businessName],
          ]}
        />
      </Card>
      <Card title="Evaluation">
        <Rows
          rows={[
            ["CIBIL score", <CibilScore key="c" score={e.cibilScore} />],
            ["Category", e.category ? CATEGORY_LABEL[e.category] : null],
            ["Risk level", <RiskBadge key="r" level={e.riskLevel} />],
            ["Debt-to-income", e.dtiBp === null ? "n/a (no income)" : `${(e.dtiBp / 100).toFixed(1)}%`],
            ["Existing loans", String(e.existingLoans)],
            [
              "Monthly EMI",
              <span key="m" className="tabular">
                {formatINR(e.monthlyEmiPaise, { decimals: false })}
              </span>,
            ],
          ]}
        />
      </Card>
      <Card title="Family and nominee">
        <Rows
          rows={[
            ["Father", c.family.fatherName],
            ["Mother", c.family.motherName],
            ["Spouse", c.family.spouseName],
            ["Nominee", c.family.nomineeName ? `${c.family.nomineeName} (${c.family.nomineeRelation})` : null],
            ...c.references.map((r, i): [string, string] => [`Reference ${i + 1}`, `${r.name} · ${r.mobile}`]),
          ]}
        />
      </Card>
      <CustomerLoans customerId={c.id} active={c.status === "ACTIVE"} />
      <ChitMemberships customerId={c.id} />
      {c.bank !== undefined && (
        <Card title="Bank account (for payouts)">
          {c.bank ? (
            <Rows
              rows={[
                ["Bank", c.bank.bankName],
                [
                  "Account number",
                  <Masked key="b" customerId={c.id} field="BANK_ACCOUNT" masked={c.bank.accountMasked} />,
                ],
                ["IFSC", c.bank.ifsc],
              ]}
            />
          ) : (
            <p className="text-sm text-fg-muted">No bank account saved.</p>
          )}
        </Card>
      )}
    </div>
  );
}

function KycTab({ c }: { c: Customer }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [viewing, setViewing] = useState<CustomerFileInfo | null>(null);
  const [rejecting, setRejecting] = useState<KycDocumentInfo | null>(null);
  const [reason, setReason] = useState("");
  const docs = c.documents ?? [];
  const types = [...new Set<KycDocType>([...KYC_REQUIRED_DEFAULT, ...docs.map((d) => d.type)])];

  const done = (u: Customer) => (
    qc.setQueryData(["customer", c.id], u),
    void qc.invalidateQueries({ queryKey: ["customers"] })
  );
  const fail = (e: unknown) =>
    toast({ tone: "danger", title: "Action failed", description: e instanceof ApiError ? e.message : undefined });
  const verify = useMutation({
    mutationFn: (t: KycDocType) => api<Customer>(`/customers/${c.id}/documents/${t}/verify`, { method: "POST" }),
    onSuccess: (u) => (done(u), toast({ tone: "success", title: "Document verified" })),
    onError: fail,
  });
  const reject = useMutation({
    mutationFn: (t: KycDocType) =>
      api<Customer>(`/customers/${c.id}/documents/${t}/reject`, { method: "POST", body: { reason } }),
    onSuccess: (u) => (
      done(u),
      setRejecting(null),
      setReason(""),
      toast({ tone: "success", title: "Document rejected" })
    ),
    onError: fail,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-muted">
          Required: {KYC_REQUIRED_DEFAULT.map((t) => DOC_LABEL[t]).join(", ")}. KYC is verified when every required
          document is verified.
        </p>
        <PermissionGate permission="customer:edit">
          <Button asChild variant="secondary" size="sm">
            <Link to={`/customers/${c.id}/edit?step=kyc`}>Add / update documents</Link>
          </Button>
        </PermissionGate>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {types.map((t) => {
          const d = docs.find((x) => x.type === t);
          const required = KYC_REQUIRED_DEFAULT.includes(t);
          return (
            <li key={t} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0 space-y-1">
                <p className="font-medium">
                  {DOC_LABEL[t]}{" "}
                  {required ? (
                    <span className="text-xs font-normal text-fg-muted">(required)</span>
                  ) : (
                    <span className="text-xs font-normal text-fg-muted">(optional)</span>
                  )}
                </p>
                {d?.numberMasked && <Masked customerId={c.id} field={t as "AADHAAR"} masked={d.numberMasked} />}
                {d?.files.length ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {d.files.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setViewing(f)}
                        className="inline-flex min-h-touch items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-surface-muted md:min-h-8"
                      >
                        <Eye className="h-3 w-3" aria-hidden /> {f.label || f.originalName}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-fg-muted">{d ? "No file uploaded" : "Not provided"}</p>
                )}
                {d?.status === "REJECTED" && d.rejectionReason && (
                  <p className="text-xs text-danger">Rejected: {d.rejectionReason}</p>
                )}
                {d?.verifiedAt && d.status === "VERIFIED" && (
                  <p className="text-xs text-fg-muted">Verified {formatDateTime(d.verifiedAt)}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {d ? <StatusBadge status={d.status} /> : <StatusBadge tone="neutral">Missing</StatusBadge>}
                {d && d.status !== "VERIFIED" && (
                  <PermissionGate permission="kyc:verify">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={verify.isPending && verify.variables === t}
                      onClick={() => verify.mutate(t)}
                      aria-label={`Verify ${DOC_LABEL[t]}`}
                    >
                      <ShieldCheck className="h-4 w-4 text-success" aria-hidden /> Verify
                    </Button>
                  </PermissionGate>
                )}
                {d && d.status !== "REJECTED" && (
                  <PermissionGate permission="kyc:reject">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setRejecting(d)}
                      aria-label={`Reject ${DOC_LABEL[t]}`}
                    >
                      <ShieldX className="h-4 w-4 text-danger" aria-hidden /> Reject
                    </Button>
                  </PermissionGate>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <FileViewer file={viewing} onClose={() => setViewing(null)} />
      <Modal
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={rejecting ? `Reject ${DOC_LABEL[rejecting.type]}` : "Reject"}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (rejecting) reject.mutate(rejecting.type);
          }}
        >
          <Field label="Reason (shown to staff who re-upload)" htmlFor="reason" required>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              required
              minLength={3}
              maxLength={300}
            />
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={reject.isPending}>
              Reject document
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function Activity({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["customer-activity", id],
    queryFn: () => api<{ id: string; at: string; by: string | null; action: string }[]>(`/customers/${id}/activity`),
  });
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  return (
    <ol className="divide-y divide-border rounded-lg border border-border bg-surface">
      {q.data?.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
          <code className="text-xs">{a.action}</code>
          <span className="text-fg-muted">
            {a.by ?? "system"} · <span className="tabular">{formatDateTime(a.at)}</span>
          </span>
        </li>
      ))}
      {q.data?.length === 0 && <li className="px-4 py-6 text-center text-sm text-fg-muted">No activity yet.</li>}
    </ol>
  );
}

export default function CustomerDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const [tab, setTab] = useState<"overview" | "kyc" | "notes" | "activity">("overview");
  const [confirm, setConfirm] = useState<"status" | "delete" | null>(null);

  const q = useQuery({ queryKey: ["customer", id], queryFn: () => api<Customer>(`/customers/${id}`) });
  const c = q.data;

  const setStatus = useMutation({
    mutationFn: (status: "ACTIVE" | "INACTIVE") =>
      api<Customer>(`/customers/${id}/status`, { method: "POST", body: { status } }),
    onSuccess: (u) => (
      qc.setQueryData(["customer", id], u),
      void qc.invalidateQueries({ queryKey: ["customers"] }),
      setConfirm(null),
      toast({ tone: "success", title: `Customer ${u.status === "ACTIVE" ? "activated" : "deactivated"}` })
    ),
    onError: (e) =>
      toast({ tone: "danger", title: "Action failed", description: e instanceof ApiError ? e.message : undefined }),
  });
  const remove = useMutation({
    mutationFn: () => api(`/customers/${id}`, { method: "DELETE" }),
    onSuccess: () => (
      void qc.invalidateQueries({ queryKey: ["customers"] }),
      toast({ tone: "success", title: "Customer deleted" }),
      navigate("/customers")
    ),
    onError: (e) =>
      toast({ tone: "danger", title: "Could not delete", description: e instanceof ApiError ? e.message : undefined }),
  });

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!c)
    return (
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold">Customer not found</h1>
        <Button asChild variant="secondary" className="mt-4">
          <Link to="/customers">Back to Customers</Link>
        </Button>
      </div>
    );
  if (c.status === "DRAFT")
    return (
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold">{c.code} is still a draft</h1>
        <Button asChild className="mt-4">
          <Link to={`/customers/${c.id}/edit`}>Continue registration</Link>
        </Button>
      </div>
    );

  const tabs = [
    { key: "overview" as const, label: "Overview", show: true },
    { key: "kyc" as const, label: "KYC & Documents", show: can("kyc:view") },
    { key: "notes" as const, label: "Notes & Follow-ups", show: true },
    { key: "activity" as const, label: "Activity", show: true },
  ].filter((t) => t.show);

  return (
    <div className="space-y-5">
      <Link to="/customers" className="inline-flex min-h-touch items-center gap-1 text-sm hover:underline md:min-h-0">
        <ChevronLeft className="h-4 w-4" aria-hidden /> Back to Customers
      </Link>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface p-5">
        <Photo customer={c} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{c.name}</h1>
          <p className="text-sm text-fg-muted">
            {c.code} · {c.phone}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge status={c.status} />
            <KycBadge status={c.kycStatus} />
            <RiskBadge level={c.evaluation.riskLevel} />
            <WatchBadge status={c.watch.status} />
          </div>
          <ProfileFlags c={c} />
        </div>
        <div className="flex flex-wrap gap-2">
          <PermissionGate permission="customer:edit">
            <Button asChild variant="secondary">
              <Link to={`/customers/${c.id}/edit`}>
                <Pencil className="h-4 w-4" aria-hidden /> Edit
              </Link>
            </Button>
            <Button variant="secondary" onClick={() => setConfirm("status")}>
              {c.status === "ACTIVE" ? "Deactivate" : "Activate"}
            </Button>
          </PermissionGate>
          <PermissionGate permission="customer:delete">
            <Button variant="danger" onClick={() => setConfirm("delete")}>
              <Trash2 className="h-4 w-4" aria-hidden /> Delete
            </Button>
          </PermissionGate>
        </div>
      </div>

      <WatchBanner c={c} />

      <div role="tablist" aria-label="Customer sections" className="flex gap-2 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "min-h-touch shrink-0 rounded-md border px-4 text-sm font-medium md:min-h-10",
              tab === t.key
                ? "border-primary bg-primary text-fg-inverse"
                : "border-border bg-surface hover:bg-surface-muted",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "overview" ? (
          <Overview c={c} />
        ) : tab === "kyc" ? (
          <KycTab c={c} />
        ) : tab === "notes" ? (
          <NotesTab customerId={c.id} />
        ) : (
          <Activity id={c.id} />
        )}
      </div>

      <ConfirmDialog
        open={confirm === "status"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={c.status === "ACTIVE" ? "Deactivate this customer?" : "Re-activate this customer?"}
        description={
          c.status === "ACTIVE"
            ? "They will be marked inactive. Their records are kept."
            : "They will be marked active again."
        }
        subjectLabel="Customer"
        customer={`${c.name} (${c.code})`}
        confirmLabel={c.status === "ACTIVE" ? "Deactivate" : "Activate"}
        destructive={c.status === "ACTIVE"}
        loading={setStatus.isPending}
        onConfirm={() => setStatus.mutate(c.status === "ACTIVE" ? "INACTIVE" : "ACTIVE")}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete this customer?"
        description="The customer is hidden from every list. Their history stays in the audit log."
        customer={`${c.name} (${c.code})`}
        confirmLabel="Delete customer"
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
