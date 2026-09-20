import {
  addDays,
  addMonths,
  allocateInterest,
  checkEligibility,
  cycleBounds,
  cycleInterest,
  loanPaymentSchema,
  loanPosition,
  loanProductSchema,
  monthlyInterest,
  principalOn,
  yearlyPercent,
} from "../src";

const RS = 100; // paise per rupee
const P = 100_000 * RS; // Rs 1,00,000
const RATE = 200; // 2% a month

describe("addMonths and cycles", () => {
  it("measures from the original day so month-ends do not drift", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonths("2026-01-31", 3)).toBe("2026-04-30");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29"); // leap year
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2026-01-15", 12)).toBe("2027-01-15");
  });
  it("cycles are back to back with no gap or overlap", () => {
    for (let seq = 1; seq < 30; seq++) {
      expect(cycleBounds("2026-01-31", seq).end).toBe(cycleBounds("2026-01-31", seq + 1).start);
    }
  });
});

describe("cycleInterest", () => {
  const base = { principalPaise: P, changes: [], monthlyRateBp: RATE };

  it("a full cycle is exactly principal x rate, whatever the month length", () => {
    for (const start of ["2026-02-01", "2026-01-01", "2026-04-01", "2028-02-01"]) {
      const { start: s, end } = cycleBounds(start, 1);
      expect(cycleInterest({ ...base, cycleStart: s, cycleEnd: end, upTo: end })).toBe(200_000); // Rs 2,000
    }
  });

  it("part-way through a cycle it is pro-rata by days", () => {
    // 14 of 28 days of February
    expect(cycleInterest({ ...base, cycleStart: "2026-02-01", cycleEnd: "2026-03-01", upTo: "2026-02-15" })).toBe(
      100_000,
    );
  });

  it("weights a mid-cycle part payment by the days each amount was outstanding", () => {
    // Rs 40,000 repaid on 11 Jan: 10 days on 1,00,000 then 21 days on 60,000, over a 31-day cycle.
    // (10,000,000 x 10 + 6,000,000 x 21) x 200 / (31 x 10,000) = 145,806.45 -> 145,806 paise
    const changes = [{ date: "2026-01-11", deltaPaise: -40_000 * RS }];
    expect(
      cycleInterest({ ...base, changes, cycleStart: "2026-01-01", cycleEnd: "2026-02-01", upTo: "2026-02-01" }),
    ).toBe(145_806);
  });

  it("does not charge for the day the loan is paid off", () => {
    // Paid off on 16 Jan: the 15 days 1..15 Jan count. 10,000,000 x 15 x 200 / (31 x 10,000) = 96,774.19
    const changes = [{ date: "2026-01-16", deltaPaise: -P }];
    expect(
      cycleInterest({ ...base, changes, cycleStart: "2026-01-01", cycleEnd: "2026-02-01", upTo: "2026-02-01" }),
    ).toBe(96_774);
  });

  it("charges nothing before the cycle starts, and never beyond the cycle", () => {
    expect(cycleInterest({ ...base, cycleStart: "2026-02-01", cycleEnd: "2026-03-01", upTo: "2026-02-01" })).toBe(0);
    expect(cycleInterest({ ...base, cycleStart: "2026-02-01", cycleEnd: "2026-03-01", upTo: "2027-01-01" })).toBe(
      200_000,
    );
  });

  it("rounds half a paisa up", () => {
    expect(monthlyInterest(25, 200)).toBe(1); // 0.5
    expect(monthlyInterest(24, 200)).toBe(0); // 0.48
    expect(monthlyInterest(P, RATE)).toBe(200_000);
    expect(yearlyPercent(200)).toBe(24);
    expect(yearlyPercent(150)).toBe(18);
  });

  it("principalOn applies a change on the day it happens", () => {
    const changes = [{ date: "2026-01-11", deltaPaise: -40_000 * RS }];
    expect(principalOn(P, changes, "2026-01-10")).toBe(P);
    expect(principalOn(P, changes, "2026-01-11")).toBe(P - 40_000 * RS);
  });
});

describe("loanPosition", () => {
  const loan = { principalPaise: P, monthlyRateBp: RATE, startDate: "2026-01-15", changes: [] as never[] };

  it("on a due date the finished cycles are due, but only earlier ones are overdue", () => {
    const pos = loanPosition({ ...loan, paidByCycle: {}, asOf: "2026-03-15" });
    expect(pos.cycles.map((c) => [c.seq, c.dueDate, c.complete])).toEqual([
      [1, "2026-02-15", true],
      [2, "2026-03-15", true],
    ]);
    expect(pos.interestDuePaise).toBe(400_000);
    expect(pos.interestOverduePaise).toBe(200_000); // cycle 1 only; cycle 2 is due today
    expect(pos.overdueCycles).toBe(1);
    expect(pos.oldestOverdueDays).toBe(28);
    expect(pos.nextDueDate).toBe("2026-02-15"); // the oldest unpaid comes first
    expect(pos.payoffPaise).toBe(P + 400_000);
  });

  it("moves the next due date on once the oldest cycle is paid", () => {
    const pos = loanPosition({ ...loan, paidByCycle: { 1: 200_000 }, asOf: "2026-03-15" });
    expect(pos.interestDuePaise).toBe(200_000);
    expect(pos.interestOverduePaise).toBe(0);
    expect(pos.nextDueDate).toBe("2026-03-15");
  });

  it("shows interest still building in the running cycle, and counts it in the payoff", () => {
    // Cycle 2 is 15 Feb to 15 Mar (28 days); on 1 Mar, 14 days have passed = half
    const pos = loanPosition({ ...loan, paidByCycle: { 1: 200_000 }, asOf: "2026-03-01" });
    expect(pos.interestDuePaise).toBe(0);
    expect(pos.interestAccruingPaise).toBe(100_000);
    expect(pos.interestPayablePaise).toBe(100_000);
    expect(pos.payoffPaise).toBe(P + 100_000);
    expect(pos.nextDueDate).toBe("2026-03-15");
    const running = pos.cycles.find((c) => !c.complete)!;
    expect(running.seq).toBe(2);
    expect(running.accruedPaise).toBe(100_000);
  });

  it("a partial payment leaves the rest outstanding on that cycle", () => {
    const pos = loanPosition({ ...loan, paidByCycle: { 1: 50_000 }, asOf: "2026-02-15" });
    expect(pos.cycles[0]!.outstandingPaise).toBe(150_000);
    expect(pos.interestOverduePaise).toBe(0); // due today
  });

  it("stops listing empty cycles once the principal is cleared, and the payoff is only interest", () => {
    // Fully repaid on 20 Feb, interest for cycle 1 paid. Cycle 2 (15 Feb - 15 Mar) earned 5 of 28 days.
    const changes = [{ date: "2026-02-20", deltaPaise: -P }];
    const pos = loanPosition({ ...loan, changes, paidByCycle: { 1: 200_000 }, asOf: "2026-06-01" });
    expect(pos.principalOutstandingPaise).toBe(0);
    expect(pos.cycles.map((c) => c.seq)).toEqual([1, 2]);
    // 10,000,000 x 5 x 200 / (28 x 10,000) = 35,714.28
    expect(pos.cycles[1]!.accruedPaise).toBe(35_714);
    expect(pos.payoffPaise).toBe(35_714);
    expect(pos.nextDueDate).toBe("2026-03-15");
  });

  it("nothing is due on the day of disbursement", () => {
    const pos = loanPosition({ ...loan, paidByCycle: {}, asOf: "2026-01-15" });
    expect(pos.interestPayablePaise).toBe(0);
    expect(pos.payoffPaise).toBe(P);
    expect(pos.nextDueDate).toBe("2026-02-15");
  });

  it("month-end loans keep their anchor day", () => {
    const pos = loanPosition({ ...loan, startDate: "2026-01-31", paidByCycle: {}, asOf: "2026-03-31" });
    expect(pos.cycles.map((c) => c.dueDate)).toEqual(["2026-02-28", "2026-03-31"]);
    expect(pos.interestDuePaise).toBe(400_000); // both full cycles cost the same
  });
});

/** Small seeded random generator so a failure can be reproduced. */
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

describe("interest properties (random cases)", () => {
  it("N untouched cycles cost exactly N x the monthly interest", () => {
    const r = rng(7);
    for (let i = 0; i < 200; i++) {
      const principal = 1000 + Math.floor(r() * 50_000_000);
      const rate = 1 + Math.floor(r() * 500);
      const day = 1 + Math.floor(r() * 31);
      const start = `2026-01-${String(day).padStart(2, "0")}`;
      const n = 1 + Math.floor(r() * 14);
      const pos = loanPosition({
        principalPaise: principal,
        monthlyRateBp: rate,
        startDate: start,
        changes: [],
        paidByCycle: {},
        asOf: addMonths(start, n),
      });
      expect(pos.interestDuePaise).toBe(n * monthlyInterest(principal, rate));
    }
  });

  it("repaying principal never increases interest, and never gives a negative or over-cap figure", () => {
    const r = rng(11);
    for (let i = 0; i < 300; i++) {
      const principal = 10_000 + Math.floor(r() * 50_000_000);
      const rate = 1 + Math.floor(r() * 500);
      const cycleStart = "2026-03-01";
      const cycleEnd = addMonths(cycleStart, 1);
      const day = Math.floor(r() * 31);
      const repay = Math.floor(r() * principal);
      const changes = [{ date: `2026-03-${String(1 + (day % 30)).padStart(2, "0")}`, deltaPaise: -repay }];
      const args = { principalPaise: principal, monthlyRateBp: rate, cycleStart, cycleEnd, upTo: cycleEnd };
      const without = cycleInterest({ ...args, changes: [] });
      const withRepay = cycleInterest({ ...args, changes });
      expect(withRepay).toBeLessThanOrEqual(without);
      expect(withRepay).toBeGreaterThanOrEqual(0);
      // and it is at least what the smallest principal would have earned for the whole cycle
      expect(withRepay).toBeGreaterThanOrEqual(monthlyInterest(principal - repay, rate) - 1);
    }
  });

  it("accrued interest only ever grows as the date moves forward", () => {
    const changes = [{ date: "2026-02-10", deltaPaise: -3_000_000 }];
    let last = 0;
    for (let n = 0; n <= 31; n++) {
      const accrued = cycleInterest({
        principalPaise: P,
        changes,
        monthlyRateBp: RATE,
        cycleStart: "2026-01-15",
        cycleEnd: "2026-02-15",
        upTo: addDays("2026-01-15", n),
      });
      expect(accrued).toBeGreaterThanOrEqual(last);
      last = accrued;
    }
  });
});

describe("allocateInterest", () => {
  const cycles = [
    { seq: 3, outstandingPaise: 300 },
    { seq: 1, outstandingPaise: 100 },
    { seq: 2, outstandingPaise: 0 },
  ];
  it("pays the oldest cycle first and skips settled ones", () => {
    expect(allocateInterest(250, cycles)).toEqual([
      { seq: 1, amountPaise: 100 },
      { seq: 3, amountPaise: 150 },
    ]);
  });
  it("never takes more than is owed", () => {
    const total = allocateInterest(10_000, cycles).reduce((s, a) => s + a.amountPaise, 0);
    expect(total).toBe(400);
  });
  it("takes nothing for a zero amount", () => {
    expect(allocateInterest(0, cycles)).toEqual([]);
  });
});

describe("checkEligibility", () => {
  const ok = {
    status: "ACTIVE",
    kycStatus: "VERIFIED",
    watchStatus: "NONE",
    cibilScore: 720,
    monthlyIncomePaise: 5_000_000, // Rs 50,000
    additionalIncomePaise: 0,
    monthlyEmiPaise: 0,
  };
  const input = (customer: Partial<typeof ok>, principalPaise = 10_000_000, activeLoans = 0) => ({
    customer: { ...ok, ...customer },
    principalPaise,
    monthlyRateBp: RATE,
    activeLoans,
  });

  it("a clean customer has no findings", () => {
    expect(checkEligibility(input({}))).toEqual({ blockers: [], warnings: [] });
  });
  it("blocks blacklisted and inactive customers", () => {
    expect(checkEligibility(input({ watchStatus: "BLACKLIST" })).blockers).toHaveLength(1);
    expect(checkEligibility(input({ status: "DRAFT" })).blockers).toHaveLength(1);
  });
  it("warns, but does not block, on KYC, watchlist, CIBIL and existing loans", () => {
    const r = checkEligibility(
      input({ kycStatus: "PENDING", watchStatus: "WATCHLIST", cibilScore: 550 }, 10_000_000, 2),
    );
    expect(r.blockers).toEqual([]);
    expect(r.warnings).toHaveLength(4);
  });
  it("warns exactly when obligations pass half of income", () => {
    // Rs 12,50,000 at 2% = Rs 25,000 a month = exactly half of Rs 50,000: no warning
    expect(checkEligibility(input({}, 125_000_000)).warnings).toEqual([]);
    // one rupee-ish more tips it over
    expect(checkEligibility(input({}, 125_005_000)).warnings).toHaveLength(1);
    // existing EMI counts too
    expect(checkEligibility(input({ monthlyEmiPaise: 1_000_000 }, 100_000_000)).warnings).toHaveLength(1);
  });
  it("warns when no income is recorded", () => {
    expect(checkEligibility(input({ monthlyIncomePaise: 0 })).warnings).toHaveLength(1);
  });
});

describe("request schemas", () => {
  it("a payment needs some amount", () => {
    expect(loanPaymentSchema.safeParse({ mode: "CASH" }).success).toBe(false);
    expect(loanPaymentSchema.safeParse({ mode: "CASH", interestPaise: 5000 }).success).toBe(true);
    expect(loanPaymentSchema.safeParse({ mode: "CASH", interestPaise: 1.5 }).success).toBe(false);
    expect(loanPaymentSchema.safeParse({ mode: "SET_OFF", interestPaise: 5000 }).success).toBe(false);
  });
  it("a product's default rate must sit inside its allowed range", () => {
    const base = { name: "Personal", monthlyRateBp: 200, minAmountPaise: 100_000, maxAmountPaise: 10_000_000 };
    expect(loanProductSchema.safeParse(base).success).toBe(true);
    expect(loanProductSchema.safeParse({ ...base, minRateBp: 250 }).success).toBe(false);
    expect(loanProductSchema.safeParse({ ...base, maxAmountPaise: 50_000 }).success).toBe(false);
    expect(loanProductSchema.safeParse({ ...base, monthlyRateBp: 1500 }).success).toBe(false);
  });
});
