import {
  allocatePayment,
  buildSchedule,
  calcPenalty,
  computeAuction,
  createChitGroupSchema,
  validateChitConfig,
  addDays,
  daysBetween,
} from "../src";

const rs = (n: number) => n * 100;

describe("computeAuction (worked examples)", () => {
  // Rs 5,00,000 chit, 20 members, Rs 25,000 subscription, 5% commission
  const base = { chitValuePaise: rs(500_000), members: 20, commissionBp: 500 };

  it("Rs 1,00,000 discount (20%)", () => {
    const r = computeAuction({ ...base, discountPaise: rs(100_000) });
    expect(r).toEqual({
      discountPaise: rs(100_000),
      commissionPaise: rs(25_000),
      dividendPoolPaise: rs(75_000),
      dividendPerMemberPaise: rs(3_750),
      residuePaise: 0,
      foremanIncomePaise: rs(25_000),
      prizePaise: rs(400_000),
      netInstallmentPaise: rs(21_250),
    });
  });

  it("collections always equal prize plus foreman income, to the paisa", () => {
    for (const d of [rs(25_000), rs(25_001), 2_500_001, rs(123_457), 12_345_679, rs(200_000)]) {
      const r = computeAuction({ ...base, discountPaise: d });
      expect(base.members * r.netInstallmentPaise).toBe(r.prizePaise + r.foremanIncomePaise);
    }
  });

  it("puts indivisible paise with the foreman", () => {
    // Rs 1,00,000 / 8 members, 5% commission = Rs 5,000. Discount Rs 7,000.50 -> pool 200,050 paise / 8 = 25,006 rem 2
    const r = computeAuction({ chitValuePaise: rs(100_000), members: 8, commissionBp: 500, discountPaise: 700_050 });
    expect(r.dividendPoolPaise).toBe(200_050);
    expect(r.dividendPerMemberPaise).toBe(25_006);
    expect(r.residuePaise).toBe(2);
    expect(r.foremanIncomePaise).toBe(500_000 + 2);
    expect(8 * r.netInstallmentPaise).toBe(r.prizePaise + r.foremanIncomePaise);
  });

  it("minimum discount equals the commission: no dividend", () => {
    const r = computeAuction({ ...base, discountPaise: rs(25_000) });
    expect(r.dividendPerMemberPaise).toBe(0);
    expect(r.netInstallmentPaise).toBe(rs(25_000));
    expect(r.prizePaise).toBe(rs(475_000));
  });

  it("lottery and fixed chits: winner gets value minus commission, no dividend", () => {
    const r = computeAuction({ ...base, discountPaise: null });
    expect(r).toMatchObject({
      prizePaise: rs(475_000),
      dividendPerMemberPaise: 0,
      netInstallmentPaise: rs(25_000),
      foremanIncomePaise: rs(25_000),
    });
  });

  it("rejects a discount below commission, above value, or a value that does not divide", () => {
    expect(() => computeAuction({ ...base, discountPaise: rs(24_999) })).toThrow(/commission/);
    expect(() => computeAuction({ ...base, discountPaise: rs(600_000) })).toThrow(/exceed/);
    expect(() => computeAuction({ chitValuePaise: 1001, members: 3, commissionBp: 500, discountPaise: 100 })).toThrow(
      /evenly/,
    );
  });

  it("rounds commission half-up on odd values", () => {
    // 5% of Rs 1,00,001 = 500,005 paise exactly; 2.5% of 10,001 paise = 250.025 -> 250
    expect(
      computeAuction({ chitValuePaise: 10_001 * 100, members: 1, commissionBp: 500, discountPaise: null })
        .commissionPaise,
    ).toBe(50_005);
    expect(
      computeAuction({ chitValuePaise: 10_001, members: 1, commissionBp: 250, discountPaise: null }).commissionPaise,
    ).toBe(250);
  });
});

describe("validateChitConfig", () => {
  const ok = {
    chitValuePaise: rs(500_000),
    members: 20,
    durationMonths: 20,
    monthlySubscriptionPaise: rs(25_000),
    commissionBp: 500,
    minBidBp: 500,
    maxBidBp: 4000,
  };

  it("accepts a consistent group", () => expect(validateChitConfig(ok)).toEqual([]));
  it("requires members × subscription = value", () =>
    expect(validateChitConfig({ ...ok, monthlySubscriptionPaise: rs(24_000) }).join()).toMatch(
      /must equal the chit value/,
    ));
  it("requires duration = members", () =>
    expect(validateChitConfig({ ...ok, durationMonths: 24 }).join()).toMatch(/Duration/));
  it("keeps the minimum bid at or above the commission", () =>
    expect(validateChitConfig({ ...ok, minBidBp: 300 }).join()).toMatch(/minimum bid/));
  it("bid limits are only enforced for auction chits", () =>
    expect(validateChitConfig({ ...ok, minBidBp: 0 }, "LOTTERY")).toEqual([]));
  it("caps commission and max bid", () => {
    expect(validateChitConfig({ ...ok, commissionBp: 1500, minBidBp: 1500 }).join()).toMatch(/Commission/);
    expect(validateChitConfig({ ...ok, maxBidBp: 6000 }).join()).toMatch(/50%/);
  });
  it("is enforced by the request schema", () => {
    const body = {
      name: "Group A",
      chitValuePaise: rs(500_000),
      members: 20,
      durationMonths: 20,
      monthlySubscriptionPaise: rs(25_000),
      startDate: "2026-10-01",
      auctionDay: 10,
    };
    expect(createChitGroupSchema.safeParse(body).success).toBe(true);
    expect(createChitGroupSchema.safeParse({ ...body, monthlySubscriptionPaise: rs(20_000) }).success).toBe(false);
    expect(createChitGroupSchema.parse(body)).toMatchObject({
      commissionBp: 500,
      dueDaysAfterAuction: 5,
      maxBidBp: 4000,
    });
  });
});

describe("buildSchedule", () => {
  it("places auctions on the auction day, monthly, across a year end", () => {
    const s = buildSchedule("2026-11-05", 10, 4, 5);
    expect(s.map((c) => c.auctionDate)).toEqual(["2026-11-10", "2026-12-10", "2027-01-10", "2027-02-10"]);
    expect(s[0]).toEqual({ month: 1, auctionDate: "2026-11-10", dueDate: "2026-11-15" });
  });
  it("clamps day 31 to the end of shorter months, including leap years", () => {
    expect(buildSchedule("2027-01-01", 31, 3, 0).map((c) => c.auctionDate)).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
    ]);
    expect(buildSchedule("2028-02-01", 30, 1, 0)[0]!.auctionDate).toBe("2028-02-29");
  });
  it("due dates can roll into the next month", () =>
    expect(buildSchedule("2026-10-01", 28, 1, 5)[0]!.dueDate).toBe("2026-11-02"));
  it("date helpers", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
  });
});

describe("calcPenalty", () => {
  const base = { outstandingPaise: rs(21_250), dueDate: "2026-11-15", graceDays: 3, rateBpPerMonth: 200 }; // 2% per month
  it("nothing within the grace period, or with no rate", () => {
    expect(calcPenalty({ ...base, asOf: "2026-11-18" })).toBe(0);
    expect(calcPenalty({ ...base, asOf: "2026-12-30", rateBpPerMonth: 0 })).toBe(0);
    expect(calcPenalty({ ...base, asOf: "2026-11-10" })).toBe(0);
  });
  it("30 days late after grace = one month of 2%", () =>
    expect(calcPenalty({ ...base, asOf: "2026-12-18" })).toBe(rs(425)));
  it("15 days late after grace = half a month", () =>
    expect(calcPenalty({ ...base, asOf: "2026-12-03" })).toBe(rs(212.5)));
  it("rounds half-up to whole paise", () =>
    expect(
      calcPenalty({
        outstandingPaise: 1000,
        dueDate: "2026-01-01",
        asOf: "2026-01-02",
        graceDays: 0,
        rateBpPerMonth: 1000,
      }),
    ).toBe(3)); // 3.33
});

describe("allocatePayment", () => {
  const dues = [
    { id: "b", dueDate: "2026-12-15", outstandingPaise: rs(21_000) },
    { id: "a", dueDate: "2026-11-15", outstandingPaise: rs(21_250) },
  ];
  it("penalty first, then the oldest due, then the next", () => {
    const r = allocatePayment(rs(30_000), rs(500), dues);
    expect(r).toEqual({
      penaltyPaise: rs(500),
      installments: [
        { id: "a", paidPaise: rs(21_250) },
        { id: "b", paidPaise: rs(8_250) },
      ],
      advancePaise: 0,
    });
  });
  it("a small payment only reduces penalty", () =>
    expect(allocatePayment(rs(200), rs(500), dues)).toEqual({
      penaltyPaise: rs(200),
      installments: [],
      advancePaise: 0,
    }));
  it("overpayment becomes advance", () => {
    const r = allocatePayment(rs(50_000), 0, dues);
    expect(r.installments.map((i) => i.paidPaise)).toEqual([rs(21_250), rs(21_000)]);
    expect(r.advancePaise).toBe(rs(7_750));
  });
  it("everything sums to the amount paid", () => {
    for (const amt of [1, 999, rs(21_250), rs(43_000), rs(90_000)]) {
      const r = allocatePayment(amt, rs(100), dues);
      expect(r.penaltyPaise + r.installments.reduce((s, i) => s + i.paidPaise, 0) + r.advancePaise).toBe(amt);
    }
  });
});
