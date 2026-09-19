import Decimal from "decimal.js";
import { z } from "zod";
import { percentOf } from "./money";
import { listQuerySchema } from "./schemas";

/* ---------- Constants ---------- */

export const CHIT_TYPES = ["AUCTION", "LOTTERY", "FIXED"] as const;
export const CHIT_STATUSES = ["DRAFT", "OPEN_FOR_ENROLMENT", "RUNNING", "COMPLETED", "CANCELLED"] as const;
export const PAYMENT_MODES = ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "SET_OFF"] as const;
export type ChitType = (typeof CHIT_TYPES)[number];
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** Basis points: 100 bp = 1%. Used for commission, bid limits and penalty so no floating point is stored. */
export const bpOf = (paise: number, bp: number) => percentOf(paise, new Decimal(bp).div(100).toString());

/* ---------- Group configuration and its rules ---------- */

export interface ChitConfig {
  chitValuePaise: number;
  members: number;
  durationMonths: number;
  monthlySubscriptionPaise: number;
  commissionBp: number;
  minBidBp: number;
  maxBidBp: number;
}

export const MAX_COMMISSION_BP = 1000; // hard ceiling of 10%; the business must set the legal cap for its state in Settings
export const MAX_MEMBERS = 200;

/** Returns human-readable problems (empty when the configuration is valid). */
export function validateChitConfig(c: ChitConfig, type: ChitType = "AUCTION"): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(c.members) || c.members < 2 || c.members > MAX_MEMBERS)
    errors.push(`Members must be between 2 and ${MAX_MEMBERS}`);
  if (c.durationMonths !== c.members)
    errors.push("Duration in months must equal the number of members (one auction per month, one prize per member)");
  if (c.chitValuePaise <= 0 || c.monthlySubscriptionPaise <= 0)
    errors.push("Chit value and monthly subscription must be positive");
  if (c.members > 0 && c.monthlySubscriptionPaise * c.members !== c.chitValuePaise) {
    errors.push(
      `Members × monthly subscription must equal the chit value (${c.members} × ${c.monthlySubscriptionPaise / 100} ≠ ${c.chitValuePaise / 100})`,
    );
  }
  if (c.commissionBp < 0 || c.commissionBp > MAX_COMMISSION_BP)
    errors.push(`Commission must be between 0% and ${MAX_COMMISSION_BP / 100}%`);
  if (type === "AUCTION") {
    if (c.minBidBp < c.commissionBp)
      errors.push(
        "The minimum bid must be at least the foreman commission, otherwise members would receive a negative dividend",
      );
    if (c.maxBidBp < c.minBidBp) errors.push("The maximum bid cannot be below the minimum bid");
    if (c.maxBidBp > 5000) errors.push("The maximum bid cannot exceed 50% of the chit value");
  }
  return errors;
}

/* ---------- The monthly auction calculation ---------- */

export interface AuctionInput {
  chitValuePaise: number;
  members: number;
  commissionBp: number;
  /** The winning discount in paise. For LOTTERY / FIXED chits pass `null`: the winner simply receives value minus commission. */
  discountPaise: number | null;
}

export interface AuctionBreakdown {
  discountPaise: number;
  commissionPaise: number;
  /** Discount left after the foreman's commission, shared among all members. */
  dividendPoolPaise: number;
  dividendPerMemberPaise: number;
  /** Paise that cannot be split evenly. Goes to the foreman, as documented in docs/decisions.md. */
  residuePaise: number;
  foremanIncomePaise: number;
  prizePaise: number;
  /** What each ticket pays this month: subscription minus dividend. */
  netInstallmentPaise: number;
}

/**
 * Standard auction chit: the winner takes chit value minus their discount. The foreman keeps a commission from the
 * discount, and the rest (the dividend) is shared equally among ALL tickets, the winner's included.
 * Check: members × netInstallment = prize + foremanIncome, always, to the paisa.
 */
export function computeAuction(i: AuctionInput): AuctionBreakdown {
  const subscription = i.chitValuePaise / i.members;
  if (!Number.isInteger(subscription)) throw new RangeError("Chit value must divide evenly by the number of members");
  const commissionPaise = bpOf(i.chitValuePaise, i.commissionBp);
  const discountPaise = i.discountPaise ?? commissionPaise;
  if (discountPaise < commissionPaise) throw new RangeError("The discount cannot be less than the foreman commission");
  if (discountPaise > i.chitValuePaise) throw new RangeError("The discount cannot exceed the chit value");

  const dividendPoolPaise = discountPaise - commissionPaise;
  const dividendPerMemberPaise = Math.floor(dividendPoolPaise / i.members);
  const residuePaise = dividendPoolPaise - dividendPerMemberPaise * i.members;
  return {
    discountPaise,
    commissionPaise,
    dividendPoolPaise,
    dividendPerMemberPaise,
    residuePaise,
    foremanIncomePaise: commissionPaise + residuePaise,
    prizePaise: i.chitValuePaise - discountPaise,
    netInstallmentPaise: subscription - dividendPerMemberPaise,
  };
}

/* ---------- Dates and schedule (UTC date strings, no timezone surprises) ---------- */

const pad = (n: number) => String(n).padStart(2, "0");
export const daysInMonth = (year: number, month1: number) => new Date(Date.UTC(year, month1, 0)).getUTCDate();

/** Adds days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export interface ScheduledCycle {
  month: number;
  auctionDate: string;
  dueDate: string;
}

/**
 * Month 1 is the month of `startDate`. Each auction falls on `auctionDay` of its month; days past the end of a short
 * month (30 or 31 in February) clamp to the last day. Installments fall due `dueDaysAfterAuction` days later.
 */
export function buildSchedule(
  startDate: string,
  auctionDay: number,
  months: number,
  dueDaysAfterAuction: number,
): ScheduledCycle[] {
  const [y, m] = startDate.split("-").map(Number) as [number, number];
  return Array.from({ length: months }, (_, i) => {
    const total = m - 1 + i;
    const year = y + Math.floor(total / 12);
    const month = (total % 12) + 1;
    const auctionDate = `${year}-${pad(month)}-${pad(Math.min(auctionDay, daysInMonth(year, month)))}`;
    return { month: i + 1, auctionDate, dueDate: addDays(auctionDate, dueDaysAfterAuction) };
  });
}

/* ---------- Penalty and payment allocation ---------- */

/** Late-payment penalty: simple interest, `rateBp` per month on the overdue amount, counted per day after the grace period. */
export function calcPenalty(i: {
  outstandingPaise: number;
  dueDate: string;
  asOf: string;
  graceDays: number;
  rateBpPerMonth: number;
}): number {
  const late = daysBetween(i.dueDate, i.asOf) - i.graceDays;
  if (late <= 0 || i.outstandingPaise <= 0 || i.rateBpPerMonth <= 0) return 0;
  return new Decimal(i.outstandingPaise)
    .times(i.rateBpPerMonth)
    .div(10_000)
    .times(late)
    .div(30)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export interface DueItem {
  id: string;
  dueDate: string;
  outstandingPaise: number;
}
export interface Allocation {
  penaltyPaise: number;
  installments: { id: string; paidPaise: number }[];
  /** Left over after everything due is paid; kept as credit against future installments. */
  advancePaise: number;
}

/** Allocation order from the brief: penalty first, then the oldest dues, then advance. */
export function allocatePayment(amountPaise: number, penaltyDuePaise: number, dues: readonly DueItem[]): Allocation {
  let left = amountPaise;
  const penaltyPaise = Math.min(left, penaltyDuePaise);
  left -= penaltyPaise;
  const installments: Allocation["installments"] = [];
  for (const d of [...dues].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
    if (left <= 0) break;
    const pay = Math.min(left, d.outstandingPaise);
    if (pay > 0) installments.push({ id: d.id, paidPaise: pay });
    left -= pay;
  }
  return { penaltyPaise, installments, advancePaise: left };
}

/* ---------- Request schemas ---------- */

const paise = z.number().int().positive().max(100_000_000_00);

const chitGroupShape = z.object({
  name: z.string().trim().min(2).max(80),
  type: z.enum(CHIT_TYPES).default("AUCTION"),
  chitValuePaise: paise,
  members: z.number().int().min(2).max(MAX_MEMBERS),
  durationMonths: z.number().int().min(2).max(MAX_MEMBERS),
  monthlySubscriptionPaise: paise,
  commissionBp: z.number().int().min(0).max(MAX_COMMISSION_BP).default(500),
  minBidBp: z.number().int().min(0).max(5000).optional(),
  maxBidBp: z.number().int().min(0).max(5000).default(4000),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  auctionDay: z.number().int().min(1).max(31),
  dueDaysAfterAuction: z.number().int().min(0).max(30).default(5),
  penaltyRateBp: z.number().int().min(0).max(1000).default(0),
  penaltyGraceDays: z.number().int().min(0).max(30).default(3),
  registrationFeePaise: z.number().int().min(0).default(0),
  notes: z.string().trim().max(500).optional(),
});

export const createChitGroupSchema = chitGroupShape.superRefine((v, ctx) => {
  const cfg: ChitConfig = { ...v, minBidBp: v.minBidBp ?? v.commissionBp };
  for (const message of validateChitConfig(cfg, v.type)) ctx.addIssue({ code: "custom", message, path: ["config"] });
});
/** Partial update. Whether a field may still change depends on the group's status, and is checked by the API. */
export const updateChitGroupSchema = chitGroupShape.partial();
export const chitListQuerySchema = listQuerySchema.extend({ status: z.enum(CHIT_STATUSES).optional() });
export const cancelChitSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export const waitlistSchema = z.object({ customerId: z.string().uuid(), note: z.string().trim().max(200).optional() });
export type CreateChitGroupInput = z.infer<typeof createChitGroupSchema>;

export const enrolSchema = z.object({
  customerId: z.string().uuid(),
  ticketNumber: z.number().int().min(1).optional(),
});
export const transferSchema = z.object({ toCustomerId: z.string().uuid(), reason: z.string().trim().min(3).max(300) });
export const bidSchema = z.object({ ticketId: z.string().uuid(), discountPaise: paise });
export const closeAuctionSchema = z.object({ note: z.string().trim().max(300).optional() });
export const paymentSchema = z.object({
  amountPaise: paise,
  mode: z.enum(PAYMENT_MODES).exclude(["SET_OFF"]),
  reference: z.string().trim().max(60).optional(),
  /** Defaults to today. A past date needs payment:backdate. */
  paidOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export const reversePaymentSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export const approvePayoutSchema = z.object({
  securityVerified: z.boolean(),
  note: z.string().trim().max(300).optional(),
});
export const payPayoutSchema = z.object({
  mode: z.enum(PAYMENT_MODES).exclude(["SET_OFF"]),
  reference: z.string().trim().max(60).optional(),
  note: z.string().trim().max(300).optional(),
});
