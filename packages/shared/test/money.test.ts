import { formatINR, paiseToRupees, percentOf, rupeesToPaise, splitEvenly, sumPaise } from "../src";

describe("money", () => {
  it("converts rupees to paise without float error", () => {
    expect(rupeesToPaise("0.1")).toBe(10);
    expect(rupeesToPaise(1234.56)).toBe(123456);
    expect(rupeesToPaise("19.99")).toBe(1999);
    expect(paiseToRupees(123456)).toBe("1234.56");
  });

  it("rejects sub-paise precision", () => {
    expect(() => rupeesToPaise("1.005")).toThrow(RangeError);
  });

  it("formats with Indian digit grouping", () => {
    expect(formatINR(10000000)).toBe("₹1,00,000.00");
    expect(formatINR(50000000, { decimals: false })).toBe("₹5,00,000");
    expect(formatINR(99999)).toBe("₹999.99");
    expect(formatINR(123456789012)).toBe("₹1,23,45,67,890.12");
    expect(formatINR(-12345)).toBe("-₹123.45");
    expect(formatINR(0)).toBe("₹0.00");
  });

  it("computes percentages with half-up rounding", () => {
    // Worked example: 5% foreman commission on Rs 5,00,000
    expect(percentOf(50000000, 5)).toBe(2500000);
    // 0.5 paise rounds up, 0.4 rounds down
    expect(percentOf(50, "1")).toBe(1);
    expect(percentOf(49, "1")).toBe(0);
    expect(percentOf(150, 1, "DOWN")).toBe(1);
    expect(percentOf(101, 1, "UP")).toBe(2);
  });

  it("splits evenly with residue on the last share", () => {
    expect(splitEvenly(100, 3)).toEqual([33, 33, 34]);
    expect(splitEvenly(90, 3)).toEqual([30, 30, 30]);
    expect(sumPaise(splitEvenly(1234567, 20))).toBe(1234567);
    expect(() => splitEvenly(100, 0)).toThrow();
  });
});
