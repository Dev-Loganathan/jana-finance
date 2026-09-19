import Decimal from "decimal.js";

/**
 * Money is always an integer number of paise (1 rupee = 100 paise).
 * Never use floating point for amounts. Interest math goes through Decimal
 * and is rounded back to whole paise with an explicit rounding mode.
 */
export type Paise = number;

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export function assertPaise(value: number): Paise {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Amount must be a safe integer number of paise, got ${value}`);
  }
  return value;
}

/** "1234.56" | 1234.56 -> 123456. Rejects more than 2 decimal places. */
export function rupeesToPaise(rupees: string | number): Paise {
  const d = new Decimal(rupees);
  if (d.decimalPlaces() > 2) {
    throw new RangeError(`Rupee amount has more than 2 decimal places: ${rupees}`);
  }
  return assertPaise(d.times(100).toNumber());
}

/** 123456 -> "1234.56" */
export function paiseToRupees(paise: Paise): string {
  return new Decimal(assertPaise(paise)).div(100).toFixed(2);
}

/** 10000000 -> "₹1,00,000.00" (Indian digit grouping). */
export function formatINR(paise: Paise, opts: { symbol?: boolean; decimals?: boolean } = {}): string {
  const { symbol = true, decimals = true } = opts;
  const negative = paise < 0;
  const abs = Math.abs(assertPaise(paise));
  const rupees = Math.floor(abs / 100).toString();
  const frac = (abs % 100).toString().padStart(2, "0");
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${negative ? "-" : ""}${symbol ? "₹" : ""}${grouped}${decimals ? "." + frac : ""}`;
}

export type RoundingMode = "HALF_UP" | "DOWN" | "UP";
const MODES: Record<RoundingMode, Decimal.Rounding> = {
  HALF_UP: Decimal.ROUND_HALF_UP,
  DOWN: Decimal.ROUND_DOWN,
  UP: Decimal.ROUND_UP,
};

/** paise * (percent / 100), rounded to whole paise. e.g. percentOf(500000_00, "5") = 25000_00. */
export function percentOf(paise: Paise, percent: string | number, mode: RoundingMode = "HALF_UP"): Paise {
  const result = new Decimal(assertPaise(paise)).times(new Decimal(percent)).div(100);
  return assertPaise(result.toDecimalPlaces(0, MODES[mode]).toNumber());
}

/**
 * Split an amount into `parts` shares that sum exactly to the total.
 * The rounding residue goes to the LAST share (decision: see docs/decisions.md).
 */
export function splitEvenly(paise: Paise, parts: number): Paise[] {
  if (!Number.isInteger(parts) || parts < 1) throw new RangeError("parts must be a positive integer");
  assertPaise(paise);
  const base = Math.trunc(paise / parts);
  const shares = Array<Paise>(parts).fill(base);
  shares[parts - 1] = paise - base * (parts - 1);
  return shares;
}

export function sumPaise(values: readonly Paise[]): Paise {
  return assertPaise(values.reduce((a, b) => a + b, 0));
}
