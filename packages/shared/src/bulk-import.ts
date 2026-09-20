import {
  addressStepSchema,
  basicStepSchema,
  employmentStepSchema,
  evaluationStepSchema,
  kycStepSchema,
  referencesStepSchema,
} from "./customers";

/**
 * Bulk customer import: one place that defines the Excel columns, what is mandatory, and how each cell is checked.
 * The template, the instructions sheet, the validator and the error file are all generated from this list, and the
 * checks reuse the registration wizard's own schemas, so bulk and manual entry can never disagree.
 */

export const IMPORT_TEMPLATE_VERSION = "1";
export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
/** Extra columns the error file adds. They are ignored when a corrected file is uploaded again. */
export const IMPORT_EXTRA_HEADERS = ["Row in your file", "Errors"] as const;

export type ColumnKind = "text" | "date" | "list" | "money" | "int";

export interface ImportColumn {
  key: string;
  header: string;
  required: boolean;
  section:
    "Basic details" | "Address" | "KYC numbers" | "Work and bank" | "Family and nominee" | "References" | "Evaluation";
  kind: ColumnKind;
  /** For lists: [label shown in the dropdown, enum value stored]. */
  options?: readonly (readonly [string, string])[];
  example: string;
  help: string;
  width: number;
}

const GENDER = [
  ["Male", "MALE"],
  ["Female", "FEMALE"],
  ["Other", "OTHER"],
] as const;
const MARITAL = [
  ["Single", "SINGLE"],
  ["Married", "MARRIED"],
  ["Widowed", "WIDOWED"],
  ["Divorced", "DIVORCED"],
] as const;
const RESIDENCE = [
  ["Own", "OWN"],
  ["Rented", "RENTED"],
  ["Family", "FAMILY"],
  ["Company", "COMPANY"],
] as const;
const OCCUPATION = [
  ["Salaried", "SALARIED"],
  ["Self employed", "SELF_EMPLOYED"],
  ["Business", "BUSINESS"],
  ["Farmer", "FARMER"],
  ["Retired", "RETIRED"],
  ["Student", "STUDENT"],
  ["Other", "OTHER"],
] as const;

const c = (col: Omit<ImportColumn, "width"> & { width?: number }): ImportColumn => ({ width: 20, ...col });

export const IMPORT_COLUMNS: readonly ImportColumn[] = [
  c({
    key: "firstName",
    header: "First name",
    required: true,
    section: "Basic details",
    kind: "text",
    example: "Anitha",
    help: "Customer's first name.",
  }),
  c({
    key: "lastName",
    header: "Last name",
    required: false,
    section: "Basic details",
    kind: "text",
    example: "Raman",
    help: "Optional.",
  }),
  c({
    key: "gender",
    header: "Gender",
    required: true,
    section: "Basic details",
    kind: "list",
    options: GENDER,
    example: "Female",
    help: "Choose from the list.",
    width: 12,
  }),
  c({
    key: "dob",
    header: "Date of birth",
    required: true,
    section: "Basic details",
    kind: "date",
    example: "15/05/1990",
    help: "DD/MM/YYYY. Must be between 18 and 100 years old.",
    width: 15,
  }),
  c({
    key: "phone",
    header: "Mobile",
    required: true,
    section: "Basic details",
    kind: "text",
    example: "9876543210",
    help: "10-digit Indian mobile number starting 6 to 9 (a +91 or 0 prefix is removed).",
    width: 14,
  }),
  c({
    key: "altPhone",
    header: "Alternate mobile",
    required: false,
    section: "Basic details",
    kind: "text",
    example: "9840012345",
    help: "Optional. Same format as Mobile.",
    width: 16,
  }),
  c({
    key: "email",
    header: "Email",
    required: false,
    section: "Basic details",
    kind: "text",
    example: "anitha@example.com",
    help: "Optional.",
    width: 24,
  }),
  c({
    key: "maritalStatus",
    header: "Marital status",
    required: true,
    section: "Basic details",
    kind: "list",
    options: MARITAL,
    example: "Married",
    help: "Choose from the list.",
    width: 15,
  }),
  c({
    key: "currentAddress",
    header: "Current address",
    required: true,
    section: "Address",
    kind: "text",
    example: "12 Gandhi Road",
    help: "Street and area.",
    width: 30,
  }),
  c({
    key: "permanentAddress",
    header: "Permanent address",
    required: true,
    section: "Address",
    kind: "text",
    example: "12 Gandhi Road",
    help: "Repeat the current address if it is the same.",
    width: 30,
  }),
  c({
    key: "state",
    header: "State",
    required: true,
    section: "Address",
    kind: "text",
    example: "Tamil Nadu",
    help: "State name.",
    width: 16,
  }),
  c({
    key: "district",
    header: "District",
    required: true,
    section: "Address",
    kind: "text",
    example: "Kanchipuram",
    help: "District or city.",
    width: 16,
  }),
  c({
    key: "pincode",
    header: "Pincode",
    required: true,
    section: "Address",
    kind: "text",
    example: "631501",
    help: "6 digits, not starting with 0.",
    width: 10,
  }),
  c({
    key: "landmark",
    header: "Landmark",
    required: false,
    section: "Address",
    kind: "text",
    example: "Near bus stand",
    help: "Optional.",
  }),
  c({
    key: "residenceType",
    header: "Residence type",
    required: true,
    section: "Address",
    kind: "list",
    options: RESIDENCE,
    example: "Own",
    help: "Choose from the list.",
    width: 15,
  }),
  c({
    key: "aadhaar",
    header: "Aadhaar number",
    required: true,
    section: "KYC numbers",
    kind: "text",
    example: "234567890124",
    help: "12 digits. The number is checked for typing errors. Spaces are removed.",
    width: 16,
  }),
  c({
    key: "pan",
    header: "PAN",
    required: true,
    section: "KYC numbers",
    kind: "text",
    example: "ABCDE1234F",
    help: "10 characters: 5 letters, 4 digits, 1 letter.",
    width: 13,
  }),
  c({
    key: "voterId",
    header: "Voter ID",
    required: false,
    section: "KYC numbers",
    kind: "text",
    example: "",
    help: "Optional.",
  }),
  c({
    key: "drivingLicence",
    header: "Driving licence",
    required: false,
    section: "KYC numbers",
    kind: "text",
    example: "",
    help: "Optional.",
  }),
  c({
    key: "passport",
    header: "Passport",
    required: false,
    section: "KYC numbers",
    kind: "text",
    example: "",
    help: "Optional.",
  }),
  c({
    key: "occupationType",
    header: "Occupation",
    required: true,
    section: "Work and bank",
    kind: "list",
    options: OCCUPATION,
    example: "Salaried",
    help: "Choose from the list.",
    width: 16,
  }),
  c({
    key: "companyName",
    header: "Employer / company",
    required: false,
    section: "Work and bank",
    kind: "text",
    example: "Sri Lakshmi Traders",
    help: "Optional.",
  }),
  c({
    key: "designation",
    header: "Designation",
    required: false,
    section: "Work and bank",
    kind: "text",
    example: "",
    help: "Optional.",
  }),
  c({
    key: "workExperience",
    header: "Work experience",
    required: false,
    section: "Work and bank",
    kind: "text",
    example: "5 years",
    help: "Optional, free text.",
    width: 16,
  }),
  c({
    key: "monthlyIncome",
    header: "Monthly income (₹)",
    required: true,
    section: "Work and bank",
    kind: "money",
    example: "35000",
    help: "Rupees, numbers only. Use 0 if there is no income.",
    width: 18,
  }),
  c({
    key: "additionalIncome",
    header: "Additional income (₹)",
    required: false,
    section: "Work and bank",
    kind: "money",
    example: "0",
    help: "Optional. Rupees per month.",
    width: 20,
  }),
  c({
    key: "businessName",
    header: "Business name",
    required: false,
    section: "Work and bank",
    kind: "text",
    example: "",
    help: "Optional. For self-employed customers.",
  }),
  c({
    key: "bankName",
    header: "Bank name",
    required: true,
    section: "Work and bank",
    kind: "text",
    example: "State Bank of India",
    help: "For payouts.",
    width: 22,
  }),
  c({
    key: "accountNumber",
    header: "Bank account number",
    required: true,
    section: "Work and bank",
    kind: "text",
    example: "30123456789",
    help: "6 to 18 digits.",
    width: 20,
  }),
  c({
    key: "ifsc",
    header: "IFSC",
    required: true,
    section: "Work and bank",
    kind: "text",
    example: "SBIN0001234",
    help: "11 characters, for example SBIN0001234.",
    width: 14,
  }),
  c({
    key: "fatherName",
    header: "Father's name",
    required: true,
    section: "Family and nominee",
    kind: "text",
    example: "Raman",
    help: "",
  }),
  c({
    key: "motherName",
    header: "Mother's name",
    required: true,
    section: "Family and nominee",
    kind: "text",
    example: "Lakshmi",
    help: "",
  }),
  c({
    key: "spouseName",
    header: "Spouse name",
    required: false,
    section: "Family and nominee",
    kind: "text",
    example: "",
    help: "Optional.",
  }),
  c({
    key: "nomineeName",
    header: "Nominee name",
    required: true,
    section: "Family and nominee",
    kind: "text",
    example: "Kumar",
    help: "",
  }),
  c({
    key: "nomineeRelation",
    header: "Nominee relation",
    required: true,
    section: "Family and nominee",
    kind: "text",
    example: "Spouse",
    help: "For example Spouse, Son, Mother.",
    width: 16,
  }),
  c({
    key: "ref1Name",
    header: "Reference 1 name",
    required: true,
    section: "References",
    kind: "text",
    example: "Suresh",
    help: "At least one reference is needed.",
  }),
  c({
    key: "ref1Mobile",
    header: "Reference 1 mobile",
    required: true,
    section: "References",
    kind: "text",
    example: "9876500002",
    help: "10-digit mobile.",
    width: 18,
  }),
  c({
    key: "ref2Name",
    header: "Reference 2 name",
    required: false,
    section: "References",
    kind: "text",
    example: "",
    help: "Optional. If you give a name, give the mobile too.",
  }),
  c({
    key: "ref2Mobile",
    header: "Reference 2 mobile",
    required: false,
    section: "References",
    kind: "text",
    example: "",
    help: "Optional.",
    width: 18,
  }),
  c({
    key: "cibilScore",
    header: "CIBIL score",
    required: true,
    section: "Evaluation",
    kind: "int",
    example: "720",
    help: "Whole number from 300 to 900.",
    width: 12,
  }),
  c({
    key: "existingLoans",
    header: "Existing loans",
    required: false,
    section: "Evaluation",
    kind: "int",
    example: "0",
    help: "Number of running loans. Blank means 0.",
    width: 14,
  }),
  c({
    key: "monthlyEmi",
    header: "Monthly EMI (₹)",
    required: false,
    section: "Evaluation",
    kind: "money",
    example: "0",
    help: "Total EMIs paid each month, in rupees. Blank means 0.",
    width: 16,
  }),
];

export const COLUMN_BY_KEY = new Map(IMPORT_COLUMNS.map((col) => [col.key, col]));
/** What the header cell shows: required columns carry a star. */
export const headerLabel = (col: ImportColumn) => (col.required ? `${col.header} *` : col.header);

/* ---------- Headers ---------- */

export const normalizeHeader = (s: string) =>
  s
    .toLowerCase()
    .replace(/[*₹()'’\s\-_./]/g, "")
    .replace(/[^a-z0-9]/g, "");
const HEADER_LOOKUP = new Map<string, string>();
for (const col of IMPORT_COLUMNS) {
  HEADER_LOOKUP.set(normalizeHeader(col.header), col.key);
  HEADER_LOOKUP.set(normalizeHeader(col.key), col.key);
}
const EXTRA = new Set(IMPORT_EXTRA_HEADERS.map(normalizeHeader));

export interface HeaderMatch {
  /** column key -> zero-based position in the file */
  index: Map<string, number>;
  missingRequired: string[];
  ignored: string[];
}

export function matchHeaders(headers: readonly string[]): HeaderMatch {
  const index = new Map<string, number>();
  const ignored: string[] = [];
  headers.forEach((h, i) => {
    const text = (h ?? "").toString().trim();
    if (!text) return;
    const key = HEADER_LOOKUP.get(normalizeHeader(text));
    if (key && !index.has(key)) index.set(key, i);
    else if (!EXTRA.has(normalizeHeader(text))) ignored.push(text);
  });
  return {
    index,
    ignored,
    missingRequired: IMPORT_COLUMNS.filter((col) => col.required && !index.has(col.key)).map((col) => col.header),
  };
}

/* ---------- Cell normalisation ---------- */

const blankish = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** Turns whatever Excel handed us (string, number, Date, rich text) into trimmed text. */
export function cellText(v: unknown): string {
  if (blankish(v)) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === "object") {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (o.richText)
      return o.richText
        .map((r) => r.text)
        .join("")
        .trim();
    if (o.result !== undefined) return cellText(o.result);
    if (o.text !== undefined) return cellText(o.text);
  }
  return String(v).trim();
}

const isRealDate = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/** Excel dates arrive as Date objects, as serial numbers, or as typed text in a few common shapes. */
export function parseDate(v: unknown): { value?: string; error?: string } {
  if (v instanceof Date)
    return Number.isNaN(v.getTime()) ? { error: "Not a valid date" } : { value: v.toISOString().slice(0, 10) };
  if (typeof v === "number") {
    if (v < 1 || v > 80_000) return { error: "Not a valid date" };
    return { value: new Date(Math.round((v - 25_569) * 86_400_000)).toISOString().slice(0, 10) };
  }
  const t = cellText(v);
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m)
    return isRealDate(+m[3]!, +m[2]!, +m[1]!)
      ? { value: `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` }
      : { error: "Not a real date. Use DD/MM/YYYY, for example 15/05/1990" };
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m)
    return isRealDate(+m[1]!, +m[2]!, +m[3]!) ? { value: `${m[1]}-${m[2]}-${m[3]}` } : { error: "Not a real date" };
  return { error: "Use a date such as 15/05/1990" };
}

/** Rupees (with optional commas or a ₹ sign, at most 2 decimals) -> whole paise. */
export function parseRupees(v: unknown): { value?: number; error?: string } {
  const t = (typeof v === "number" ? String(v) : cellText(v)).replace(/[₹,\s]/g, "").replace(/^rs\.?/i, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t))
    return { error: /^-/.test(t) ? "Cannot be negative" : "Enter an amount in rupees, for example 35000" };
  const [r, p = ""] = t.split(".");
  const paise = Number(r) * 100 + Number(p.padEnd(2, "0"));
  return Number.isSafeInteger(paise) ? { value: paise } : { error: "Amount is too large" };
}

export function parseWhole(v: unknown): { value?: number; error?: string } {
  const t = cellText(v);
  if (typeof v === "number" ? !Number.isInteger(v) : !/^\d+$/.test(t)) return { error: "Enter a whole number" };
  return { value: Number(t) };
}

const optionKey = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
export function parseOption(col: ImportColumn, v: unknown): { value?: string; error?: string } {
  const k = optionKey(cellText(v));
  const hit = col.options!.find(([label, value]) => optionKey(label) === k || optionKey(value) === k);
  return hit ? { value: hit[1] } : { error: `Choose one of: ${col.options!.map(([l]) => l).join(", ")}` };
}

/* ---------- Row validation ---------- */

export interface RowError {
  column: string;
  message: string;
}

export interface ImportedSteps {
  basic: Record<string, unknown>;
  address: Record<string, unknown>;
  kyc: Record<string, unknown>;
  employment: Record<string, unknown>;
  references: Record<string, unknown>;
  evaluation: Record<string, unknown>;
}

export interface RowResult {
  name: string;
  errors: RowError[];
  steps?: ImportedSteps;
}

/** Where each schema field path lives in the sheet. */
function columnOfPath(path: readonly (string | number)[]): string {
  const [a, b, c] = path;
  if (a === "monthlyIncomePaise") return "monthlyIncome";
  if (a === "additionalIncomePaise") return "additionalIncome";
  if (a === "monthlyEmiPaise") return "monthlyEmi";
  if (a === "bank" && typeof b === "string") return b;
  if (a === "references")
    return b === undefined ? "ref1Name" : `ref${Number(b) + 1}${c === "mobile" ? "Mobile" : "Name"}`;
  return String(a);
}

/**
 * Checks one spreadsheet row. `raw` maps column key -> cell value. Every problem is reported against its column, so the
 * user sees all mistakes in a row at once and not only the first.
 */
export function validateImportRow(raw: Record<string, unknown>): RowResult {
  const errors: RowError[] = [];
  const bad = new Set<string>();
  const fail = (column: string, message: string) => {
    if (!bad.has(column)) {
      bad.add(column);
      errors.push({ column, message });
    }
  };
  const v: Record<string, unknown> = {};

  for (const col of IMPORT_COLUMNS) {
    const cell = raw[col.key];
    if (blankish(cell)) {
      if (col.required) fail(col.key, "Required");
      continue;
    }
    if (col.kind === "text") v[col.key] = cellText(cell);
    else {
      const r =
        col.kind === "date"
          ? parseDate(cell)
          : col.kind === "money"
            ? parseRupees(cell)
            : col.kind === "int"
              ? parseWhole(cell)
              : parseOption(col, cell);
      if (r.error) fail(col.key, r.error);
      else v[col.key] = r.value;
    }
  }

  const optional = (o: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined && x !== ""));
  const refs = [1, 2]
    .map((n) => optional({ name: v[`ref${n}Name`], mobile: v[`ref${n}Mobile`] }))
    .filter((r) => Object.keys(r).length > 0);
  const steps: ImportedSteps = {
    basic: optional({
      firstName: v.firstName,
      lastName: v.lastName,
      gender: v.gender,
      dob: v.dob,
      phone: v.phone,
      altPhone: v.altPhone,
      email: v.email,
      maritalStatus: v.maritalStatus,
    }),
    address: optional({
      currentAddress: v.currentAddress,
      permanentAddress: v.permanentAddress,
      state: v.state,
      district: v.district,
      pincode: v.pincode,
      landmark: v.landmark,
      residenceType: v.residenceType,
    }),
    kyc: optional({
      aadhaar: v.aadhaar,
      pan: v.pan,
      voterId: v.voterId,
      drivingLicence: v.drivingLicence,
      passport: v.passport,
    }),
    employment: {
      ...optional({
        occupationType: v.occupationType,
        companyName: v.companyName,
        designation: v.designation,
        workExperience: v.workExperience,
        monthlyIncomePaise: v.monthlyIncome,
        businessName: v.businessName,
      }),
      additionalIncomePaise: (v.additionalIncome as number | undefined) ?? 0,
      bank: optional({ bankName: v.bankName, accountNumber: v.accountNumber, ifsc: v.ifsc }),
    },
    references: {
      ...optional({
        fatherName: v.fatherName,
        motherName: v.motherName,
        spouseName: v.spouseName,
        nomineeName: v.nomineeName,
        nomineeRelation: v.nomineeRelation,
      }),
      references: refs,
    },
    evaluation: {
      ...optional({ cibilScore: v.cibilScore }),
      existingLoans: (v.existingLoans as number | undefined) ?? 0,
      monthlyEmiPaise: (v.monthlyEmi as number | undefined) ?? 0,
    },
  };

  // The wizard's own rules decide everything else (formats, checksums, age, ranges). Columns already reported are not repeated.
  const schemas = [
    ["basic", basicStepSchema],
    ["address", addressStepSchema],
    ["kyc", kycStepSchema],
    ["employment", employmentStepSchema],
    ["references", referencesStepSchema],
    ["evaluation", evaluationStepSchema],
  ] as const;
  const cleaned: Record<string, Record<string, unknown>> = {};
  for (const [step, schema] of schemas) {
    const r = schema.safeParse(steps[step]);
    if (r.success) cleaned[step] = r.data as Record<string, unknown>;
    else
      for (const issue of r.error.issues)
        fail(
          columnOfPath(issue.path),
          issue.message === "Required" ||
            issue.message.startsWith("Invalid input") ||
            issue.message.startsWith("Expected")
            ? "Required"
            : issue.message,
        );
  }

  const name = [cellText(raw.firstName), cellText(raw.lastName)].filter(Boolean).join(" ");
  if (errors.length > 0) return { name, errors };
  // Optional blanks that the schemas turned into "" are dropped so they are simply "not provided"
  const strip = (o: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(o)
        .filter(([, x]) => x !== "" && x !== undefined)
        .map(([k, x]) => [
          k,
          x && typeof x === "object" && !Array.isArray(x) ? strip(x as Record<string, unknown>) : x,
        ]),
    );
  return {
    name,
    errors,
    steps: Object.fromEntries(Object.entries(cleaned).map(([k, o]) => [k, strip(o)])) as unknown as ImportedSteps,
  };
}
