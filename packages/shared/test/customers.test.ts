import {
  aadhaarSchema,
  basicStepSchema,
  deriveKycStatus,
  draftStepSchema,
  evaluate,
  ifscSchema,
  maskId,
  panSchema,
  verhoeffAppend,
  verhoeffValid,
} from "../src";

describe("ID validators", () => {
  it("builds and checks Verhoeff numbers (Aadhaar checksum)", () => {
    // Well-known Verhoeff test vector: 236 -> check digit 3
    expect(verhoeffAppend("236")).toBe("2363");
    expect(verhoeffValid("2363")).toBe(true);
    expect(verhoeffValid("2364")).toBe(false);
  });

  it("accepts a valid Aadhaar with spaces, rejects typos and bad prefixes", () => {
    const valid = verhoeffAppend("23456789012");
    expect(aadhaarSchema.parse(`${valid.slice(0, 4)} ${valid.slice(4, 8)} ${valid.slice(8)}`)).toBe(valid);
    const typo = valid.slice(0, 11) + ((Number(valid[11]) + 1) % 10);
    expect(aadhaarSchema.safeParse(typo).success).toBe(false);
    expect(aadhaarSchema.safeParse(verhoeffAppend("12345678901")).success).toBe(false); // cannot start with 0 or 1
    expect(aadhaarSchema.safeParse("1234").success).toBe(false);
  });

  it("normalises PAN and IFSC and rejects bad formats", () => {
    expect(panSchema.parse(" abcde1234f ")).toBe("ABCDE1234F");
    expect(panSchema.safeParse("ABCDE12345").success).toBe(false);
    expect(ifscSchema.parse("sbin0001234")).toBe("SBIN0001234");
    expect(ifscSchema.safeParse("SBIN1001234").success).toBe(false);
  });

  it("masks numbers", () => {
    expect(maskId("AADHAAR", "9012", 12)).toBe("XXXX-XXXX-9012");
    expect(maskId("PAN", "234F", 10)).toBe("XXXXXX234F");
  });
});

describe("wizard schemas", () => {
  it("draft schemas allow missing fields but still reject invalid ones", () => {
    const draft = draftStepSchema("basic");
    expect(draft.safeParse({ firstName: "Anu" }).success).toBe(true);
    expect(draft.safeParse({ phone: "12345" }).success).toBe(false);
    expect(basicStepSchema.safeParse({ firstName: "Anu" }).success).toBe(false);
  });

  it("reports a badly formatted date of birth only once", () => {
    const r = basicStepSchema.shape.dob.safeParse("15/05/1990");
    expect(r.success ? [] : r.error.issues.map((i) => i.message)).toEqual(["Use YYYY-MM-DD"]);
  });

  it("enforces adult age on date of birth", () => {
    const base = { firstName: "A", gender: "MALE", phone: "9876543210", maritalStatus: "SINGLE" };
    const year = new Date().getFullYear();
    expect(basicStepSchema.safeParse({ ...base, dob: `${year - 10}-01-01` }).success).toBe(false);
    expect(basicStepSchema.safeParse({ ...base, dob: `${year - 30}-01-01` }).success).toBe(true);
  });
});

describe("evaluate (risk and category)", () => {
  const base = { cibilScore: 780, monthlyIncomePaise: 50_000_00, additionalIncomePaise: 0, monthlyEmiPaise: 5_000_00 };

  it("is LOW risk / EXCELLENT with a high score and low EMI burden", () => {
    expect(evaluate(base)).toEqual({
      totalIncomePaise: 50_000_00,
      dtiBp: 1000,
      riskLevel: "LOW",
      category: "EXCELLENT",
    });
  });

  it("zero income is always HIGH risk and has no DTI (matches the existing app)", () => {
    const r = evaluate({ ...base, cibilScore: 700, monthlyIncomePaise: 0 });
    expect(r.dtiBp).toBeNull();
    expect(r.riskLevel).toBe("HIGH");
    expect(r.category).toBe("GOOD");
  });

  it("band edges", () => {
    expect(evaluate({ ...base, cibilScore: 649 }).riskLevel).toBe("HIGH");
    expect(evaluate({ ...base, cibilScore: 649 }).category).toBe("POOR");
    expect(evaluate({ ...base, cibilScore: 650 }).category).toBe("MEDIUM");
    expect(evaluate({ ...base, cibilScore: 749 }).riskLevel).toBe("MEDIUM");
    expect(evaluate({ ...base, monthlyEmiPaise: 15_000_00 }).riskLevel).toBe("LOW"); // exactly 30%
    expect(evaluate({ ...base, monthlyEmiPaise: 15_001_00 }).riskLevel).toBe("MEDIUM");
    expect(evaluate({ ...base, monthlyEmiPaise: 25_001_00 }).riskLevel).toBe("HIGH");
  });

  it("counts additional income and rounds DTI to whole basis points", () => {
    const r = evaluate({ ...base, additionalIncomePaise: 10_000_00, monthlyEmiPaise: 10_000_00 });
    expect(r.totalIncomePaise).toBe(60_000_00);
    expect(r.dtiBp).toBe(1667);
  });
});

describe("deriveKycStatus", () => {
  const doc = (
    type: "AADHAAR" | "PAN" | "PHOTO",
    status: "PENDING" | "VERIFIED" | "REJECTED" | "EXPIRED",
    hasFile = true,
  ) => ({
    type,
    status,
    hasFile,
    hasNumber: false,
  });

  it("walks NOT_STARTED -> PARTIAL -> COMPLETE -> VERIFIED", () => {
    expect(deriveKycStatus([])).toBe("NOT_STARTED");
    expect(deriveKycStatus([doc("AADHAAR", "PENDING")])).toBe("PARTIAL");
    const all = ["AADHAAR", "PAN", "PHOTO"] as const;
    expect(deriveKycStatus(all.map((t) => doc(t, "PENDING")))).toBe("COMPLETE");
    expect(deriveKycStatus(all.map((t) => doc(t, "VERIFIED")))).toBe("VERIFIED");
  });

  it("a rejected required document drops the customer back to PARTIAL", () => {
    expect(deriveKycStatus([doc("AADHAAR", "REJECTED"), doc("PAN", "VERIFIED"), doc("PHOTO", "VERIFIED")])).toBe(
      "PARTIAL",
    );
  });

  it("an expired required document flags EXPIRED", () => {
    expect(deriveKycStatus([doc("AADHAAR", "EXPIRED"), doc("PAN", "VERIFIED"), doc("PHOTO", "VERIFIED")])).toBe(
      "EXPIRED",
    );
  });
});
