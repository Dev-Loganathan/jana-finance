import { z } from "zod";
import {
  GENDERS,
  MARITAL_STATUSES,
  OCCUPATION_TYPES,
  RESIDENCE_TYPES,
  STEP_SCHEMAS,
  addressStepSchema,
  employmentStepSchema,
  evaluate,
  kycStepSchema,
  type WizardStep,
} from "@jana/shared";
import { formatINR } from "@jana/shared";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { DocSlot } from "../DocSlot";
import { CATEGORY_LABEL, RiskBadge } from "../badges";
import type { CustomerDetail } from "../types";
import { SelectField, TextAreaField, TextField, WizardFooter, humanize, opts } from "./fields";
import { parseRupees, toRupeesText, useStepForm } from "./useStepForm";

export interface StepProps {
  customer: CustomerDetail;
  isFirst: boolean;
  isLast: boolean;
  /** Called with the saved customer after a successful validate-and-save. */
  onNext: (c: CustomerDetail) => void | Promise<void>;
  onBack: () => void;
  onSaved: (c: CustomerDetail) => void;
}

const s = (v: string | null | undefined) => v ?? "";

function Shell({ children, onSubmit }: { children: React.ReactNode; onSubmit: () => void }) {
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

/* ---------------- 1. Basic ---------------- */
export function BasicStep({ customer, isFirst, onNext, onBack, onSaved }: StepProps) {
  const { form, saving, saveDraft, validateAndSave } = useStepForm({
    customer,
    step: "basic",
    defaults: {
      firstName: s(customer.firstName),
      lastName: s(customer.lastName),
      gender: s(customer.gender),
      dob: s(customer.dob),
      phone: s(customer.phone),
      altPhone: s(customer.altPhone),
      email: s(customer.email),
      maritalStatus: s(customer.maritalStatus),
    },
    toBody: (v) => ({ ...v }),
  });
  return (
    <Shell
      onSubmit={async () => {
        const c = await validateAndSave();
        if (c) await onNext(c);
      }}
    >
      <div className="mb-6 max-w-xs">
        <DocSlot
          customer={customer}
          type="PHOTO"
          slot="selfie"
          label="Customer photo"
          accept="image/*"
          capture="user"
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField form={form} name="firstName" label="First Name" required autoComplete="off" />
        <TextField form={form} name="lastName" label="Last Name" autoComplete="off" />
        <SelectField form={form} name="gender" label="Gender" required placeholder="Select" options={opts(GENDERS)} />
        <TextField form={form} name="dob" label="Date of Birth" required type="date" />
        <TextField form={form} name="phone" label="Mobile Number" required inputMode="tel" placeholder="9876543210" />
        <TextField form={form} name="altPhone" label="Alternate Number" inputMode="tel" />
        <TextField form={form} name="email" label="Email" type="email" />
        <SelectField
          form={form}
          name="maritalStatus"
          label="Marital Status"
          required
          placeholder="Select"
          options={opts(MARITAL_STATUSES)}
        />
      </div>
      <WizardFooter
        onBack={onBack}
        backDisabled={isFirst}
        busy={saving}
        nextLabel="Next"
        onSaveDraft={async () => {
          const c = await saveDraft();
          if (c) onSaved(c);
        }}
      />
    </Shell>
  );
}

/* ---------------- 2. Address ---------------- */
const STATES = [
  "Andhra Pradesh",
  "Karnataka",
  "Kerala",
  "Puducherry",
  "Tamil Nadu",
  "Telangana",
  "Maharashtra",
  "Gujarat",
  "Delhi",
  "West Bengal",
  "Uttar Pradesh",
  "Rajasthan",
  "Madhya Pradesh",
  "Bihar",
  "Odisha",
  "Punjab",
  "Haryana",
  "Other",
];

export function AddressStep({ customer, isFirst, onNext, onBack, onSaved }: StepProps) {
  const a = customer.address;
  const { form, saving, saveDraft, validateAndSave } = useStepForm({
    customer,
    step: "address",
    defaults: {
      currentAddress: s(a.currentAddress),
      permanentAddress: s(a.permanentAddress),
      country: a.country || "India",
      state: s(a.state),
      district: s(a.district),
      pincode: s(a.pincode),
      landmark: s(a.landmark),
      residenceType: s(a.residenceType) || "OWN",
    },
    toBody: (v) => ({ ...v }),
    strict: addressStepSchema,
  });
  return (
    <Shell
      onSubmit={async () => {
        const c = await validateAndSave();
        if (c) await onNext(c);
      }}
    >
      <div className="space-y-4">
        <TextAreaField form={form} name="currentAddress" label="Current Address" required />
        <div className="-mt-2">
          <button
            type="button"
            className="min-h-touch text-xs text-primary hover:underline md:min-h-0"
            onClick={() => form.setValue("permanentAddress", form.getValues("currentAddress"))}
          >
            Same as current address
          </button>
        </div>
        <TextAreaField form={form} name="permanentAddress" label="Permanent Address" required />
        <div className="grid gap-4 md:grid-cols-3">
          <TextField form={form} name="country" label="Country" required />
          <TextField form={form} name="state" label="State" required list="states" />
          <datalist id="states">
            {STATES.map((st) => (
              <option key={st} value={st} />
            ))}
          </datalist>
          <TextField form={form} name="district" label="District / City" required />
          <TextField form={form} name="pincode" label="Pincode" required inputMode="numeric" maxLength={6} />
          <TextField form={form} name="landmark" label="Landmark" />
          <SelectField
            form={form}
            name="residenceType"
            label="Residence Type"
            required
            options={opts(RESIDENCE_TYPES)}
          />
        </div>
      </div>
      <WizardFooter
        onBack={onBack}
        backDisabled={isFirst}
        busy={saving}
        nextLabel="Next"
        onSaveDraft={async () => {
          const c = await saveDraft();
          if (c) onSaved(c);
        }}
      />
    </Shell>
  );
}

/* ---------------- 3. KYC & documents ---------------- */
export function KycStep({ customer, isFirst, onNext, onBack, onSaved }: StepProps) {
  const docNumber = (t: string) => customer.documents?.find((d) => d.type === t)?.numberMasked;
  // A number that is already saved does not need to be typed again (it is masked); typing a new one replaces it.
  const strict = kycStepSchema.extend({
    ...(docNumber("AADHAAR") && { aadhaar: kycStepSchema.shape.aadhaar.optional() }),
    ...(docNumber("PAN") && { pan: kycStepSchema.shape.pan.optional() }),
  });
  const { form, saving, saveDraft, validateAndSave } = useStepForm({
    customer,
    step: "kyc",
    defaults: { aadhaar: "", pan: "", voterId: "", drivingLicence: "", passport: "" },
    toBody: (v) => ({ ...v }),
    strict,
  });
  const saved = (t: string) => (docNumber(t) ? `Saved: ${docNumber(t)}. Type a new number to replace it.` : undefined);
  return (
    <Shell
      onSubmit={async () => {
        const c = await validateAndSave();
        if (c) await onNext(c);
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          form={form}
          name="aadhaar"
          label="Aadhaar Number"
          required={!docNumber("AADHAAR")}
          inputMode="numeric"
          autoComplete="off"
          placeholder="1234 5678 9012"
          hint={saved("AADHAAR")}
        />
        <TextField
          form={form}
          name="pan"
          label="PAN Number"
          required={!docNumber("PAN")}
          autoComplete="off"
          placeholder="ABCDE1234F"
          hint={saved("PAN")}
        />
        <TextField form={form} name="voterId" label="Voter ID" autoComplete="off" hint={saved("VOTER_ID")} />
        <TextField
          form={form}
          name="drivingLicence"
          label="Driving License"
          autoComplete="off"
          hint={saved("DRIVING_LICENCE")}
        />
        <TextField form={form} name="passport" label="Passport" autoComplete="off" hint={saved("PASSPORT")} />
      </div>
      <div className="mt-8 border-t border-border pt-4">
        <h3 className="mb-1 font-semibold">Document Uploads</h3>
        <p className="mb-4 text-sm text-fg-muted">
          Files upload as soon as you choose them, so you can finish KYC over several visits. A reviewer verifies each
          document.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <DocSlot customer={customer} type="AADHAAR" slot="front" label="Aadhaar Front" />
          <DocSlot customer={customer} type="AADHAAR" slot="back" label="Aadhaar Back" />
          <DocSlot customer={customer} type="PAN" slot="card" label="PAN Card" />
          <DocSlot customer={customer} type="SIGNATURE" slot="signature" label="Signature" accept="image/*" />
          <DocSlot customer={customer} type="ADDRESS_PROOF" slot="proof" label="Address Proof" />
          <DocSlot customer={customer} type="OTHER" slot="additional" label="Additional Document" />
        </div>
      </div>
      <WizardFooter
        onBack={onBack}
        backDisabled={isFirst}
        busy={saving}
        nextLabel="Next"
        onSaveDraft={async () => {
          const c = await saveDraft();
          if (c) onSaved(c);
        }}
      />
    </Shell>
  );
}

/* ---------------- 4. Employment + bank ---------------- */
export function EmploymentStep({ customer, isFirst, onNext, onBack, onSaved }: StepProps) {
  const e = customer.employment;
  const bank = customer.bank;
  const strict = employmentStepSchema.extend({
    // Saved account numbers are masked, so an existing account may keep its number.
    bank: bank
      ? employmentStepSchema.shape.bank.extend({
          accountNumber: employmentStepSchema.shape.bank.shape.accountNumber.optional(),
        })
      : employmentStepSchema.shape.bank,
  });
  const { form, saving, saveDraft, validateAndSave } = useStepForm({
    customer,
    step: "employment",
    defaults: {
      occupationType: s(e.occupationType) || "SALARIED",
      companyName: s(e.companyName),
      designation: s(e.designation),
      workExperience: s(e.workExperience),
      monthlyIncome: toRupeesText(e.monthlyIncomePaise),
      additionalIncome: toRupeesText(e.additionalIncomePaise),
      businessName: s(e.businessName),
      bankName: bank?.bankName ?? "",
      accountNumber: "",
      ifsc: bank?.ifsc ?? "",
    },
    toBody: (v) => ({
      occupationType: v.occupationType,
      companyName: v.companyName,
      designation: v.designation,
      workExperience: v.workExperience,
      businessName: v.businessName,
      monthlyIncomePaise: parseRupees(v.monthlyIncome) ?? 0,
      additionalIncomePaise: parseRupees(v.additionalIncome) ?? 0,
      bank: { bankName: v.bankName, accountNumber: v.accountNumber, ifsc: v.ifsc },
    }),
    strict,
  });
  const amount = (n: "monthlyIncome" | "additionalIncome") => n;
  return (
    <Shell
      onSubmit={async () => {
        const c = await validateAndSave();
        if (c) await onNext(c);
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField
          form={form}
          name="occupationType"
          label="Occupation Type"
          required
          options={OCCUPATION_TYPES.map((v) => ({ value: v, label: humanize(v) }))}
        />
        <TextField form={form} name="companyName" label="Company Name" />
        <TextField form={form} name="designation" label="Designation" />
        <TextField form={form} name="workExperience" label="Work Experience" placeholder="e.g. 5 years" />
        <TextField
          form={form}
          name={amount("monthlyIncome")}
          label="Monthly Salary / Income (₹)"
          required
          inputMode="decimal"
        />
        <TextField form={form} name={amount("additionalIncome")} label="Additional Income (₹)" inputMode="decimal" />
        <TextField form={form} name="businessName" label="Business Name (if self-employed)" />
      </div>
      <div className="mt-8 border-t border-border pt-4">
        <h3 className="mb-4 font-semibold">Bank Details</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <TextField form={form} name="bankName" label="Bank Name" required={!bank} />
          <TextField
            form={form}
            name="accountNumber"
            label="Account Number"
            required={!bank}
            inputMode="numeric"
            autoComplete="off"
            hint={bank ? `Saved: ${bank.accountMasked}. Type a new number to replace it.` : undefined}
          />
          <TextField
            form={form}
            name="ifsc"
            label="IFSC Code"
            required={!bank}
            placeholder="SBIN0001234"
            autoCapitalize="characters"
          />
        </div>
      </div>
      <WizardFooter
        onBack={onBack}
        backDisabled={isFirst}
        busy={saving}
        nextLabel="Next"
        onSaveDraft={async () => {
          const c = await saveDraft();
          if (c) onSaved(c);
        }}
      />
    </Shell>
  );
}

/* ---------------- 5. Family, nominee, references ---------------- */
export function ReferencesStep({ customer, isFirst, onNext, onBack, onSaved }: StepProps) {
  const f = customer.family;
  const r = customer.references;
  const { form, saving, saveDraft, validateAndSave } = useStepForm({
    customer,
    step: "references",
    defaults: {
      fatherName: s(f.fatherName),
      motherName: s(f.motherName),
      spouseName: s(f.spouseName),
      nomineeName: s(f.nomineeName),
      nomineeRelation: s(f.nomineeRelation),
      r1Name: r[0]?.name ?? "",
      r1Mobile: r[0]?.mobile ?? "",
      r2Name: r[1]?.name ?? "",
      r2Mobile: r[1]?.mobile ?? "",
    },
    toBody: (v) => ({
      fatherName: v.fatherName,
      motherName: v.motherName,
      spouseName: v.spouseName,
      nomineeName: v.nomineeName,
      nomineeRelation: v.nomineeRelation,
      references: [
        { name: v.r1Name, mobile: v.r1Mobile },
        ...(v.r2Name || v.r2Mobile ? [{ name: v.r2Name, mobile: v.r2Mobile }] : []),
      ],
    }),
    strict: STEP_SCHEMAS.references,
  });
  return (
    <Shell
      onSubmit={async () => {
        const c = await validateAndSave();
        if (c) await onNext(c);
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <TextField form={form} name="fatherName" label="Father's Name" required />
        <TextField form={form} name="motherName" label="Mother's Name" required />
        <TextField form={form} name="spouseName" label="Spouse Name" />
      </div>
      <div className="mt-8 border-t border-border pt-4">
        <h3 className="mb-4 font-semibold">Nominee</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField form={form} name="nomineeName" label="Nominee Name" required />
          <TextField form={form} name="nomineeRelation" label="Relation" required placeholder="e.g. Spouse" />
        </div>
      </div>
      <div className="mt-8 border-t border-border pt-4">
        <h3 className="mb-4 font-semibold">References</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField form={form} name="r1Name" label="Reference 1 Name" required />
          <TextField form={form} name="r1Mobile" label="Reference 1 Mobile" required inputMode="tel" />
          <TextField form={form} name="r2Name" label="Reference 2 Name" />
          <TextField form={form} name="r2Mobile" label="Reference 2 Mobile" inputMode="tel" />
        </div>
      </div>
      <WizardFooter
        onBack={onBack}
        backDisabled={isFirst}
        busy={saving}
        nextLabel="Next"
        onSaveDraft={async () => {
          const c = await saveDraft();
          if (c) onSaved(c);
        }}
      />
    </Shell>
  );
}

/* ---------------- 6. Evaluation + consent ---------------- */
export function EvaluationStep({ customer, isFirst, isLast, onNext, onBack, onSaved }: StepProps) {
  const ev = customer.evaluation;
  const isDraft = customer.status === "DRAFT";
  const strict = STEP_SCHEMAS.evaluation.extend({
    consentGiven:
      isDraft && !customer.consentAt
        ? z.literal(true, { errorMap: () => ({ message: "Consent is required to register the customer" }) })
        : z.boolean().optional(),
  });
  const { form, saving, saveDraft, validateAndSave } = useStepForm({
    customer,
    step: "evaluation",
    defaults: {
      cibilScore: ev.cibilScore === null ? "700" : String(ev.cibilScore),
      existingLoans: String(ev.existingLoans),
      monthlyEmi: toRupeesText(ev.monthlyEmiPaise),
      consent: !!customer.consentAt,
    },
    toBody: (v) => ({
      cibilScore: v.cibilScore === "" ? undefined : Number(v.cibilScore),
      existingLoans: v.existingLoans === "" ? 0 : Number(v.existingLoans),
      monthlyEmiPaise: parseRupees(v.monthlyEmi) ?? 0,
      ...(v.consent ? { consentGiven: true } : {}),
    }),
    strict,
  });

  // Live preview of the automatic evaluation, using the income saved in step 4.
  const cibil = Number(form.watch("cibilScore"));
  const emi = parseRupees(form.watch("monthlyEmi")) ?? 0;
  const preview =
    Number.isFinite(cibil) && cibil >= 300 && cibil <= 900 && !Number.isNaN(emi)
      ? evaluate({
          cibilScore: cibil,
          monthlyIncomePaise: customer.employment.monthlyIncomePaise,
          additionalIncomePaise: customer.employment.additionalIncomePaise,
          monthlyEmiPaise: emi,
        })
      : null;
  const consentError = (form.formState.errors as Record<string, { message?: string } | undefined>).consentGiven
    ?.message;

  return (
    <Shell
      onSubmit={async () => {
        const c = await validateAndSave();
        if (c) await onNext(c);
      }}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <TextField form={form} name="cibilScore" label="CIBIL Score (300-900)" required inputMode="numeric" />
        <TextField form={form} name="existingLoans" label="Existing Loans" required inputMode="numeric" />
        <TextField form={form} name="monthlyEmi" label="Monthly EMI (₹)" required inputMode="decimal" />
      </div>
      <div className="mt-6 rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-3 font-semibold">Auto-calculated Evaluation</h3>
        <dl className="grid gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-fg-muted">Total Income</dt>
            <dd className="tabular mt-1 text-lg font-semibold">
              {formatINR(preview?.totalIncomePaise ?? customer.evaluation.totalIncomePaise, { decimals: false })}
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">Debt-to-Income</dt>
            <dd className="tabular mt-1 text-lg font-semibold">
              {preview?.dtiBp === null || preview?.dtiBp === undefined ? "n/a" : `${(preview.dtiBp / 100).toFixed(1)}%`}
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">Risk Level</dt>
            <dd className="mt-1">
              <RiskBadge level={preview?.riskLevel ?? null} />
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">Category</dt>
            <dd className="mt-1 font-medium">{preview ? CATEGORY_LABEL[preview.category] : "-"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-fg-muted">
          Risk and category are computed from CIBIL score and debt-to-income. Zero income is always high risk. They
          update automatically.
        </p>
      </div>

      <fieldset className="mt-6 rounded-lg border border-border p-4">
        <legend className="px-1 font-semibold">Consent and declaration</legend>
        <Field label="" htmlFor="consent" error={consentError}>
          <label className="flex min-h-touch items-start gap-3 text-sm md:min-h-0">
            <input id="consent" type="checkbox" className="mt-1 h-4 w-4" {...form.register("consent")} />
            <span>
              The customer has consented to Jana Finance collecting and processing their personal and KYC information
              for evaluating and servicing loans and chit funds, and for legal and regulatory compliance. They have been
              told they can ask for correction or deletion as permitted by law.
              {customer.consentAt && (
                <span className="mt-1 block text-xs text-fg-muted">
                  Consent recorded on{" "}
                  {new Date(customer.consentAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.
                </span>
              )}
            </span>
          </label>
        </Field>
      </fieldset>

      <WizardFooter
        onBack={onBack}
        backDisabled={isFirst}
        busy={saving}
        nextLabel={isLast ? (isDraft ? "Create Customer" : "Save changes") : "Next"}
        onSaveDraft={async () => {
          const c = await saveDraft();
          if (c) onSaved(c);
        }}
      />
    </Shell>
  );
}

export const STEP_COMPONENTS: Record<WizardStep, (p: StepProps) => JSX.Element> = {
  basic: BasicStep,
  address: AddressStep,
  kyc: KycStep,
  employment: EmploymentStep,
  references: ReferencesStep,
  evaluation: EvaluationStep,
};

export const STEP_LABELS: Record<WizardStep, string> = {
  basic: "Basic Details",
  address: "Address",
  kyc: "KYC & Documents",
  employment: "Employment",
  references: "References",
  evaluation: "Evaluation",
};

void Button;
