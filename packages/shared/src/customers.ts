import { z } from "zod";
import { listQuerySchema, phoneSchema } from "./schemas";

/* ---------- Enums (mirrored in the Prisma schema) ---------- */

export const GENDERS = ["MALE", "FEMALE", "OTHER"] as const;
export const MARITAL_STATUSES = ["SINGLE", "MARRIED", "WIDOWED", "DIVORCED"] as const;
export const RESIDENCE_TYPES = ["OWN", "RENTED", "FAMILY", "COMPANY"] as const;
export const OCCUPATION_TYPES = [
  "SALARIED",
  "SELF_EMPLOYED",
  "BUSINESS",
  "FARMER",
  "RETIRED",
  "STUDENT",
  "OTHER",
] as const;
export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export const CREDIT_CATEGORIES = ["EXCELLENT", "GOOD", "MEDIUM", "POOR"] as const;
export const CUSTOMER_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE"] as const;
export const KYC_STATUSES = ["NOT_STARTED", "PARTIAL", "COMPLETE", "VERIFIED", "EXPIRED"] as const;
export const NOTE_KINDS = ["NOTE", "CALL", "VISIT"] as const;
export const WATCH_STATUSES = ["NONE", "WATCHLIST", "BLACKLIST"] as const;
export const KYC_DOC_STATUSES = ["PENDING", "VERIFIED", "REJECTED", "EXPIRED"] as const;

/** Documents that carry an ID number (encrypted at rest, masked in the UI). */
export const KYC_NUMBERED_TYPES = ["AADHAAR", "PAN", "VOTER_ID", "DRIVING_LICENCE", "PASSPORT"] as const;
export const KYC_DOC_TYPES = [
  ...KYC_NUMBERED_TYPES,
  "PHOTO",
  "SIGNATURE",
  "ADDRESS_PROOF",
  "INCOME_PROOF",
  "BANK_STATEMENT",
  "OTHER",
] as const;
export type KycDocType = (typeof KYC_DOC_TYPES)[number];
export type KycNumberedType = (typeof KYC_NUMBERED_TYPES)[number];

/** Default KYC policy. Becomes per-product configuration in Settings; "Verified" needs all of these verified. */
export const KYC_REQUIRED_DEFAULT: readonly KycDocType[] = ["AADHAAR", "PAN", "PHOTO"];

export const WIZARD_STEPS = ["basic", "address", "kyc", "employment", "references", "evaluation"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/* ---------- ID number validators ---------- */

// Verhoeff checksum tables (Aadhaar uses this to detect typos).
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

export function verhoeffValid(digits: string): boolean {
  let c = 0;
  const rev = digits.split("").reverse();
  for (let i = 0; i < rev.length; i++) c = D[c]![P[i % 8]![Number(rev[i])]!]!;
  return c === 0;
}

/** Appends the Verhoeff check digit. Used by tests and seed data to build valid sample Aadhaar numbers. */
export function verhoeffAppend(digits: string): string {
  let c = 0;
  const rev = digits.split("").reverse();
  for (let i = 0; i < rev.length; i++) c = D[c]![P[(i + 1) % 8]![Number(rev[i])]!]!;
  return digits + INV[c];
}

const strip = (v: string) => v.replace(/[\s-]/g, "");

export const aadhaarSchema = z
  .string()
  .transform(strip)
  .pipe(
    z
      .string()
      .regex(/^[2-9]\d{11}$/, "Aadhaar must be 12 digits")
      .refine(verhoeffValid, "Aadhaar number is not valid"),
  );
export const panSchema = z
  .string()
  .transform((v) => strip(v).toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN looks like ABCDE1234F"));
export const ifscSchema = z
  .string()
  .transform((v) => strip(v).toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC looks like SBIN0001234"));
const looseId = (label: string) =>
  z
    .string()
    .transform((v) => strip(v).toUpperCase())
    .pipe(
      z
        .string()
        .min(5, `${label} is too short`)
        .max(20, `${label} is too long`)
        .regex(/^[A-Z0-9/]+$/, `${label} has invalid characters`),
    );

export const ID_VALIDATORS: Record<KycNumberedType, z.ZodType<string, z.ZodTypeDef, string>> = {
  AADHAAR: aadhaarSchema,
  PAN: panSchema,
  VOTER_ID: looseId("Voter ID"),
  DRIVING_LICENCE: looseId("Driving licence"),
  PASSPORT: looseId("Passport"),
};

/** "XXXX-XXXX-1234" style masking. Aadhaar is grouped in fours; everything else keeps only the last 4 characters. */
export function maskId(type: KycNumberedType | "ACCOUNT", last4: string, length: number): string {
  if (type === "AADHAAR") return `XXXX-XXXX-${last4}`;
  return "X".repeat(Math.max(0, length - 4)) + last4;
}

/* ---------- Wizard step schemas (strict = complete; partial = draft saves) ---------- */

const optionalText = (max = 120) => z.string().trim().max(max).optional().or(z.literal(""));
const paise = z.number().int().min(0).max(1_000_000_000_00);

export const basicStepSchema = z.object({
  firstName: z.string().trim().min(1, "Required").max(80),
  lastName: optionalText(80),
  gender: z.enum(GENDERS),
  dob: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .refine((v) => {
      // A wrong format is already reported by the regex above; do not add a second, confusing message.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return true;
      const d = new Date(v);
      const age = (Date.now() - d.getTime()) / (365.25 * 86_400_000);
      return !Number.isNaN(d.getTime()) && age >= 18 && age <= 100;
    }, "Customer must be between 18 and 100 years old"),
  phone: phoneSchema,
  altPhone: phoneSchema.optional().or(z.literal("")),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  maritalStatus: z.enum(MARITAL_STATUSES),
});

export const addressStepSchema = z.object({
  currentAddress: z.string().trim().min(3, "Required").max(300),
  permanentAddress: z.string().trim().min(3, "Required").max(300),
  country: z.string().trim().min(2).max(60).default("India"),
  state: z.string().trim().min(2, "Required").max(60),
  district: z.string().trim().min(2, "Required").max(60),
  pincode: z.string().regex(/^[1-9]\d{5}$/, "6-digit pincode"),
  landmark: optionalText(120),
  residenceType: z.enum(RESIDENCE_TYPES),
});

export const kycStepSchema = z.object({
  aadhaar: aadhaarSchema,
  pan: panSchema,
  voterId: ID_VALIDATORS.VOTER_ID.optional().or(z.literal("")),
  drivingLicence: ID_VALIDATORS.DRIVING_LICENCE.optional().or(z.literal("")),
  passport: ID_VALIDATORS.PASSPORT.optional().or(z.literal("")),
});

export const employmentStepSchema = z.object({
  occupationType: z.enum(OCCUPATION_TYPES),
  companyName: optionalText(),
  designation: optionalText(),
  workExperience: optionalText(40),
  monthlyIncomePaise: paise,
  additionalIncomePaise: paise.default(0),
  businessName: optionalText(),
  bank: z.object({
    bankName: z.string().trim().min(2, "Required").max(80),
    accountNumber: z
      .string()
      .transform(strip)
      .pipe(z.string().regex(/^\d{6,18}$/, "6 to 18 digits")),
    ifsc: ifscSchema,
  }),
});

export const referencesStepSchema = z.object({
  fatherName: z.string().trim().min(1, "Required").max(80),
  motherName: z.string().trim().min(1, "Required").max(80),
  spouseName: optionalText(80),
  nomineeName: z.string().trim().min(1, "Required").max(80),
  nomineeRelation: z.string().trim().min(1, "Required").max(40),
  references: z
    .array(z.object({ name: z.string().trim().min(1, "Required").max(80), mobile: phoneSchema }))
    .min(1, "At least one reference")
    .max(5),
});

export const evaluationStepSchema = z.object({
  cibilScore: z.number().int().min(300, "300 to 900").max(900, "300 to 900"),
  existingLoans: z.number().int().min(0).max(50),
  monthlyEmiPaise: paise,
  /** DPDP consent: must be true on submit. The server stamps the time and who captured it. */
  consentGiven: z.boolean().optional(),
});

export const STEP_SCHEMAS = {
  basic: basicStepSchema,
  address: addressStepSchema,
  kyc: kycStepSchema,
  employment: employmentStepSchema,
  references: referencesStepSchema,
  evaluation: evaluationStepSchema,
} as const;

/** Draft saves accept incomplete data, but anything that IS provided must still be valid. */
export const draftStepSchema = (step: WizardStep) => {
  const schema = STEP_SCHEMAS[step] as z.ZodObject<z.ZodRawShape>;
  return schema.partial();
};

/** Minimal walk-in registration: enough to identify the person now, the rest is completed later. */
export const quickAddSchema = z.object({
  firstName: basicStepSchema.shape.firstName,
  lastName: basicStepSchema.shape.lastName,
  phone: phoneSchema,
});

/* ---------- Evaluation (risk grade and credit category) ---------- */

export type RiskLevel = (typeof RISK_LEVELS)[number];
export type CreditCategory = (typeof CREDIT_CATEGORIES)[number];

/** Defaults. Moves into Settings so the owner can tune them. */
export const EVALUATION_BANDS = {
  excellentCibil: 750,
  goodCibil: 700,
  mediumCibil: 650,
  highDtiPercent: 50,
  mediumDtiPercent: 30,
} as const;

export interface Evaluation {
  totalIncomePaise: number;
  /** Debt-to-income in basis points (100 bp = 1%). Integer so no floating point creeps in. */
  dtiBp: number | null;
  riskLevel: RiskLevel;
  category: CreditCategory;
}

export function evaluate(input: {
  cibilScore: number;
  monthlyIncomePaise: number;
  additionalIncomePaise: number;
  monthlyEmiPaise: number;
}): Evaluation {
  const b = EVALUATION_BANDS;
  const totalIncomePaise = input.monthlyIncomePaise + input.additionalIncomePaise;
  const dtiBp = totalIncomePaise > 0 ? Math.round((input.monthlyEmiPaise * 10_000) / totalIncomePaise) : null;

  const category: CreditCategory =
    input.cibilScore >= b.excellentCibil
      ? "EXCELLENT"
      : input.cibilScore >= b.goodCibil
        ? "GOOD"
        : input.cibilScore >= b.mediumCibil
          ? "MEDIUM"
          : "POOR";

  // Compare exactly with integer cross-multiplication; the rounded dtiBp is for display only.
  const dtiOver = (pct: number) => input.monthlyEmiPaise * 100 > totalIncomePaise * pct;

  let riskLevel: RiskLevel;
  if (dtiBp === null || input.cibilScore < b.mediumCibil || dtiOver(b.highDtiPercent)) riskLevel = "HIGH";
  else if (input.cibilScore < b.excellentCibil || dtiOver(b.mediumDtiPercent)) riskLevel = "MEDIUM";
  else riskLevel = "LOW";

  return { totalIncomePaise, dtiBp, riskLevel, category };
}

/* ---------- KYC status derivation ---------- */

export interface KycDocSummary {
  type: KycDocType;
  status: (typeof KYC_DOC_STATUSES)[number];
  hasFile: boolean;
  hasNumber: boolean;
}

export function deriveKycStatus(
  docs: readonly KycDocSummary[],
  required: readonly KycDocType[] = KYC_REQUIRED_DEFAULT,
): (typeof KYC_STATUSES)[number] {
  if (docs.length === 0) return "NOT_STARTED";
  const provided = (t: KycDocType) =>
    docs.some((d) => d.type === t && d.status !== "REJECTED" && d.status !== "EXPIRED" && (d.hasFile || d.hasNumber));
  const verified = (t: KycDocType) => docs.some((d) => d.type === t && d.status === "VERIFIED");
  if (required.some((t) => docs.some((d) => d.type === t && d.status === "EXPIRED")) && !required.every(verified))
    return "EXPIRED";
  if (!required.every(provided)) return "PARTIAL";
  return required.every(verified) ? "VERIFIED" : "COMPLETE";
}

/* ---------- Request schemas for the customer API ---------- */

export const customerListQuerySchema = listQuerySchema.extend({
  status: z.enum(CUSTOMER_STATUSES).optional(),
  risk: z.enum(RISK_LEVELS).optional(),
  category: z.enum(CREDIT_CATEGORIES).optional(),
  kyc: z.enum(KYC_STATUSES).optional(),
  cibilMin: z.coerce.number().int().min(300).max(900).optional(),
  cibilMax: z.coerce.number().int().min(300).max(900).optional(),
  watch: z.enum(WATCH_STATUSES).optional(),
  tag: z.string().trim().max(30).optional(),
});
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

export const createCustomerSchema = quickAddSchema.partial();

export const submitCustomerSchema = z.object({ acknowledgeDuplicates: z.boolean().default(false) });

export const duplicateCheckSchema = z.object({
  /** Check a stored customer (used by the wizard after saving a step). */
  customerId: z.string().uuid().optional(),
  phone: z.string().optional(),
  aadhaar: z.string().optional(),
  pan: z.string().optional(),
  name: z.string().trim().optional(),
  dob: z.string().optional(),
  excludeId: z.string().uuid().optional(),
});

export const REVEALABLE_FIELDS = [...KYC_NUMBERED_TYPES, "BANK_ACCOUNT"] as const;
export const revealSchema = z.object({ field: z.enum(REVEALABLE_FIELDS) });

export const rejectDocSchema = z.object({ reason: z.string().trim().min(3, "Give a reason").max(300) });
export const setCustomerStatusSchema = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]) });

/* ---------- Notes, follow-ups, tags, watch status ---------- */

export const createNoteSchema = z.object({
  kind: z.enum(NOTE_KINDS).default("NOTE"),
  body: z.string().trim().min(1, "Write something").max(1000),
  /** Call/visit outcome, e.g. "promised to pay on 25th". */
  outcome: z.string().trim().max(200).optional(),
  /** Follow-up date (YYYY-MM-DD). Creates a task that shows as due until completed. */
  followUpOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional(),
});
export const setTagsSchema = z.object({ tags: z.array(z.string().trim().min(1).max(30)).max(10) });
export const setWatchSchema = z
  .object({ status: z.enum(WATCH_STATUSES), reason: z.string().trim().max(300).optional() })
  .refine((v) => v.status === "NONE" || (v.reason && v.reason.length >= 5), {
    path: ["reason"],
    message: "Give a reason (at least 5 characters)",
  });
