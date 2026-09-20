import { z } from "zod";
import { PAYMENT_MODES, daysBetween } from "./chit";
import { listQuerySchema } from "./schemas";

/**
 * Fixed-rate, monthly-interest loans.
 *
 * - The rate is a fixed percentage of the outstanding principal per MONTH, stored in basis points (200 = 2%/month).
 * - Interest is simple (never compounds) and is due every month on the anniversary of the disbursement date.
 * - Principal can be repaid at any time, in part or in full. Interest is charged on the principal that was outstanding
 *   on each day: every day from the cycle start up to, but not including, the day it is paid off counts once.
 * - Everything is whole paise. One rounding per cycle (half up), so a full cycle is exactly principal x rate.
 */

export const LOAN_STATUSES = ["APPLIED", "APPROVED", "ACTIVE", "CLOSED", "REJECTED", "CANCELLED"] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];
export const COLLATERAL_KINDS = [
  "GOLD",
  "PROPERTY",
  "VEHICLE",
  "CHEQUE",
  "PROMISSORY_NOTE",
  "DOCUMENT",
  "OTHER",
] as const;
export type CollateralKind = (typeof COLLATERAL_KINDS)[number];
export const MAX_MONTHLY_RATE_BP = 1000; // 10% a month is the hard ceiling; the business sets its own limits per product

/* ---------- Dates (YYYY-MM-DD, calendar arithmetic only: no timezones, no DST) ---------- */

const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * `start` plus `months` calendar months, always measured from the ORIGINAL day so 31 Jan gives 28 Feb then 31 Mar
 * (never 28 Feb then 28 Mar). A day that does not exist in the target month falls on that month's last day.
 */
export function addMonths(start: string, months: number): string {
  const y = +start.slice(0, 4);
  const m = +start.slice(5, 7) - 1 + months;
  const day = +start.slice(8, 10);
  const first = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return fmt(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, last)));
}

/** Cycle `seq` (1-based) covers [addMonths(start, seq-1), addMonths(start, seq)); its interest is due on the end date. */
export function cycleBounds(start: string, seq: number) {
  return { start: addMonths(start, seq - 1), end: addMonths(start, seq) };
}

/* ---------- Interest ---------- */

/** A change to the outstanding principal that takes effect ON `date` (a repayment is a negative delta). */
export interface PrincipalChange {
  date: string;
  deltaPaise: number;
}

export function principalOn(principalPaise: number, changes: readonly PrincipalChange[], date: string): number {
  let p = principalPaise;
  for (const c of changes) if (c.date <= date) p += c.deltaPaise;
  return p;
}

function roundHalfUp(numerator: bigint, denominator: bigint): number {
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

/**
 * Interest for the part of a cycle from `cycleStart` up to (not including) `upTo`, weighted by the days each principal
 * amount was outstanding, over the full cycle length. `upTo` at or beyond `cycleEnd` gives the whole cycle.
 */
export function cycleInterest(o: {
  principalPaise: number;
  changes: readonly PrincipalChange[];
  monthlyRateBp: number;
  cycleStart: string;
  cycleEnd: string;
  upTo: string;
}): number {
  const end = o.upTo < o.cycleEnd ? o.upTo : o.cycleEnd;
  if (end <= o.cycleStart) return 0;
  const cycleDays = daysBetween(o.cycleStart, o.cycleEnd);
  // Segment boundaries: the cycle start, every principal change inside the cycle, and the end.
  const points = [o.cycleStart, ...o.changes.map((c) => c.date).filter((d) => d > o.cycleStart && d < end), end].sort();
  let weighted = 0n;
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]!;
    const to = points[i + 1]!;
    if (to <= from) continue;
    weighted += BigInt(principalOn(o.principalPaise, o.changes, from)) * BigInt(daysBetween(from, to));
  }
  return roundHalfUp(weighted * BigInt(o.monthlyRateBp), BigInt(cycleDays) * 10_000n);
}

export interface InterestCycle {
  seq: number;
  periodStart: string;
  dueDate: string;
  /** Interest earned so far this cycle (the whole cycle's interest once it is complete). */
  accruedPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  /** The cycle has ended, so its interest is fully due. */
  complete: boolean;
  /** Whole days past the due date, 0 if not late. */
  overdueDays: number;
}

export interface LoanPosition {
  principalOutstandingPaise: number;
  cycles: InterestCycle[];
  /** Interest of finished cycles still unpaid. */
  interestDuePaise: number;
  /** Part of that which is past its due date (a cycle due today is due, not overdue). */
  interestOverduePaise: number;
  /** Interest earned in the running cycle and not yet paid. It can be collected early. */
  interestAccruingPaise: number;
  /** Everything a customer could pay in interest today: due + accruing. */
  interestPayablePaise: number;
  /** Principal + interest payable: what it takes to close the loan on `asOf`. */
  payoffPaise: number;
  nextDueDate: string | null;
  overdueCycles: number;
  oldestOverdueDays: number;
}

/**
 * Where a loan stands on `asOf`, worked out from first principles (start date, principal changes, interest paid per
 * cycle). Nothing is cached, so a corrected or reversed payment can never leave a stale figure behind.
 */
export function loanPosition(o: {
  principalPaise: number;
  monthlyRateBp: number;
  startDate: string;
  changes: readonly PrincipalChange[];
  paidByCycle: Readonly<Record<number, number>>;
  asOf: string;
}): LoanPosition {
  const changes = [...o.changes].sort((a, b) => a.date.localeCompare(b.date));
  const principalOutstandingPaise = principalOn(o.principalPaise, changes, o.asOf);
  const cycles: InterestCycle[] = [];
  let due = 0;
  let overdue = 0;
  let accruing = 0;
  let overdueCycles = 0;
  let oldest = 0;
  let nextDueDate: string | null = null;

  for (let seq = 1; ; seq++) {
    const { start, end } = cycleBounds(o.startDate, seq);
    if (start >= o.asOf && seq > 1) break;
    if (start > o.asOf) break;
    const accrued = cycleInterest({
      principalPaise: o.principalPaise,
      changes,
      monthlyRateBp: o.monthlyRateBp,
      cycleStart: start,
      cycleEnd: end,
      upTo: o.asOf,
    });
    const paid = o.paidByCycle[seq] ?? 0;
    const complete = end <= o.asOf;
    const outstanding = Math.max(0, accrued - paid);
    const lateDays = complete && outstanding > 0 ? Math.max(0, daysBetween(end, o.asOf)) : 0;
    // A cycle with nothing earned and nothing paid (principal already cleared) is not worth listing.
    if (accrued > 0 || paid > 0 || seq === 1) {
      cycles.push({
        seq,
        periodStart: start,
        dueDate: end,
        accruedPaise: accrued,
        paidPaise: paid,
        outstandingPaise: outstanding,
        complete,
        overdueDays: lateDays,
      });
    }
    if (complete) {
      due += outstanding;
      if (lateDays > 0) {
        overdue += outstanding;
        overdueCycles++;
        oldest = Math.max(oldest, lateDays);
      }
    } else {
      accruing += outstanding;
    }
    if (!complete) {
      if (principalOutstandingPaise > 0) nextDueDate = end;
      break;
    }
    if (principalOutstandingPaise === 0 && end >= o.asOf) break;
  }
  // An unpaid finished cycle is the next thing to collect, and it comes first.
  const firstUnpaid = cycles.find((c) => c.complete && c.outstandingPaise > 0);
  if (firstUnpaid) nextDueDate = firstUnpaid.dueDate;

  return {
    principalOutstandingPaise,
    cycles,
    interestDuePaise: due,
    interestOverduePaise: overdue,
    interestAccruingPaise: accruing,
    interestPayablePaise: due + accruing,
    payoffPaise: principalOutstandingPaise + due + accruing,
    nextDueDate,
    overdueCycles,
    oldestOverdueDays: oldest,
  };
}

/** Splits an interest payment over the unpaid cycles, oldest first. Returns the amount taken per cycle. */
export function allocateInterest(
  amountPaise: number,
  cycles: readonly Pick<InterestCycle, "seq" | "outstandingPaise">[],
): { seq: number; amountPaise: number }[] {
  let left = amountPaise;
  const out: { seq: number; amountPaise: number }[] = [];
  for (const c of [...cycles].sort((a, b) => a.seq - b.seq)) {
    if (left <= 0) break;
    const take = Math.min(left, c.outstandingPaise);
    if (take > 0) out.push({ seq: c.seq, amountPaise: take });
    left -= take;
  }
  return out;
}

/** The interest one full month costs on a principal at a rate. Shown when applying, before any loan exists. */
export const monthlyInterest = (principalPaise: number, monthlyRateBp: number) =>
  roundHalfUp(BigInt(principalPaise) * BigInt(monthlyRateBp), 10_000n);

/** Percent per month as a yearly figure for reference only (simple, not compounded). */
export const yearlyPercent = (monthlyRateBp: number) => (monthlyRateBp * 12) / 100;

/* ---------- Eligibility checks at application ---------- */

export interface EligibilityInput {
  customer: {
    status: string;
    kycStatus: string;
    watchStatus: string;
    cibilScore: number | null;
    monthlyIncomePaise: number;
    additionalIncomePaise: number;
    monthlyEmiPaise: number;
  };
  principalPaise: number;
  monthlyRateBp: number;
  activeLoans: number;
}

export interface Eligibility {
  /** These stop the application. */
  blockers: string[];
  /** These do not: the approver must acknowledge them with a reason. */
  warnings: string[];
}

export const MAX_ACTIVE_LOANS_WARN = 2;
export const LOW_CIBIL = 600;

export function checkEligibility(i: EligibilityInput): Eligibility {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const c = i.customer;
  if (c.status !== "ACTIVE")
    blockers.push("The customer must be active. Finish the registration and give consent first.");
  if (c.watchStatus === "BLACKLIST") blockers.push("The customer is blacklisted, so no new loans can be given.");
  if (c.watchStatus === "WATCHLIST") warnings.push("The customer is on the watchlist.");
  if (c.kycStatus !== "VERIFIED") warnings.push("KYC is not fully verified.");
  if (c.cibilScore !== null && c.cibilScore < LOW_CIBIL) warnings.push(`CIBIL score is below ${LOW_CIBIL}.`);
  if (i.activeLoans >= MAX_ACTIVE_LOANS_WARN)
    warnings.push(`The customer already has ${i.activeLoans} active loans with you.`);
  const income = c.monthlyIncomePaise + c.additionalIncomePaise;
  const burden = c.monthlyEmiPaise + monthlyInterest(i.principalPaise, i.monthlyRateBp);
  // Compare by cross-multiplying, so there is no rounding at the 50% line.
  if (income <= 0) warnings.push("No income is recorded for this customer.");
  else if (burden * 2 > income)
    warnings.push("Monthly obligations including this interest would exceed 50% of income.");
  return { blockers, warnings };
}

/* ---------- Request shapes ---------- */

const paise = z.number().int().positive().max(99_999_999_999);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rateBp = z.number().int().min(1).max(MAX_MONTHLY_RATE_BP);

export const loanProductSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    monthlyRateBp: rateBp,
    minRateBp: rateBp.optional(),
    maxRateBp: rateBp.optional(),
    minAmountPaise: paise,
    maxAmountPaise: paise,
    processingFeeBp: z.number().int().min(0).max(1000).default(0),
    processingFeeFlatPaise: z.number().int().min(0).max(99_999_999).default(0),
    active: z.boolean().default(true),
    notes: z.string().trim().max(300).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.maxAmountPaise < v.minAmountPaise)
      ctx.addIssue({ code: "custom", path: ["maxAmountPaise"], message: "Maximum cannot be below the minimum" });
    const lo = v.minRateBp ?? v.monthlyRateBp;
    const hi = v.maxRateBp ?? v.monthlyRateBp;
    if (hi < lo)
      ctx.addIssue({ code: "custom", path: ["maxRateBp"], message: "Maximum rate cannot be below the minimum" });
    if (v.monthlyRateBp < lo || v.monthlyRateBp > hi)
      ctx.addIssue({
        code: "custom",
        path: ["monthlyRateBp"],
        message: "The default rate must be inside the allowed range",
      });
  });
export type LoanProductInput = z.infer<typeof loanProductSchema>;

const guarantor = {
  guarantorName: z.string().trim().max(80).optional(),
  guarantorPhone: z
    .string()
    .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number")
    .optional()
    .or(z.literal("")),
  guarantorRelation: z.string().trim().max(40).optional(),
};

export const createLoanSchema = z.object({
  customerId: z.string().uuid(),
  productId: z.string().uuid(),
  principalPaise: paise,
  monthlyRateBp: rateBp,
  /** Optional expected end. There is no fixed schedule: principal may be repaid any time. */
  termMonths: z.number().int().min(1).max(120).optional(),
  purpose: z.string().trim().max(200).optional(),
  processingFeePaise: z.number().int().min(0).max(99_999_999).optional(),
  notes: z.string().trim().max(500).optional(),
  ...guarantor,
});
export const updateLoanSchema = createLoanSchema.omit({ customerId: true, productId: true }).partial();
export type CreateLoanInput = z.infer<typeof createLoanSchema>;

export const loanListQuerySchema = listQuerySchema.extend({
  status: z.enum(LOAN_STATUSES).optional(),
  customerId: z.string().uuid().optional(),
});
export const interestDueQuerySchema = z.object({
  bucket: z.enum(["overdue", "today", "week", "all"]).default("all"),
  q: z.string().trim().max(100).optional(),
  asOf: ymd.optional(),
});
export const rejectLoanSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export const approveLoanSchema = z.object({ overrideReason: z.string().trim().min(3).max(300).optional() });
export const disburseLoanSchema = z.object({
  mode: z.enum(PAYMENT_MODES).exclude(["SET_OFF"]),
  reference: z.string().trim().max(60).optional(),
  disbursedOn: ymd.optional(),
});
export const loanPaymentSchema = z
  .object({
    interestPaise: z.number().int().min(0).max(99_999_999_999).default(0),
    principalPaise: z.number().int().min(0).max(99_999_999_999).default(0),
    mode: z.enum(PAYMENT_MODES).exclude(["SET_OFF"]),
    reference: z.string().trim().max(60).optional(),
    paidOn: ymd.optional(),
  })
  .refine((v) => v.interestPaise + v.principalPaise > 0, { message: "Enter an interest or principal amount" });
export type LoanPaymentInput = z.infer<typeof loanPaymentSchema>;
export const collateralSchema = z.object({
  kind: z.enum(COLLATERAL_KINDS),
  description: z.string().trim().min(2).max(200),
  estimatedValuePaise: z.number().int().min(0).max(99_999_999_999).default(0),
  reference: z.string().trim().max(60).optional(),
});
export const releaseCollateralSchema = z.object({ note: z.string().trim().max(200).optional() });
