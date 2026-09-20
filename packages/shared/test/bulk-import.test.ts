import {
  IMPORT_COLUMNS,
  cellText,
  headerLabel,
  matchHeaders,
  parseDate,
  parseOption,
  parseRupees,
  parseWhole,
  validateImportRow,
  verhoeffAppend,
  COLUMN_BY_KEY,
} from "../src";

const AADHAAR = verhoeffAppend("23456789012");

/** A completely valid row, keyed by column key. */
const good = (): Record<string, unknown> => ({
  firstName: "Anitha",
  lastName: "Raman",
  gender: "Female",
  dob: "15/05/1990",
  phone: "9876543210",
  maritalStatus: "Married",
  currentAddress: "12 Gandhi Road",
  permanentAddress: "12 Gandhi Road",
  state: "Tamil Nadu",
  district: "Kanchipuram",
  pincode: "631501",
  residenceType: "Own",
  aadhaar: AADHAAR,
  pan: "abcde1234f",
  occupationType: "Self employed",
  monthlyIncome: "35,000",
  bankName: "State Bank of India",
  accountNumber: "30123456789",
  ifsc: "sbin0001234",
  fatherName: "Raman",
  motherName: "Lakshmi",
  nomineeName: "Kumar",
  nomineeRelation: "Spouse",
  ref1Name: "Suresh",
  ref1Mobile: "9876500002",
  cibilScore: 720,
});

const errorsOf = (raw: Record<string, unknown>) =>
  Object.fromEntries(validateImportRow(raw).errors.map((e) => [e.column, e.message]));

describe("column definitions", () => {
  it("has unique keys, and every mandatory wizard field is a required column", () => {
    expect(new Set(IMPORT_COLUMNS.map((c) => c.key)).size).toBe(IMPORT_COLUMNS.length);
    const required = IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.key);
    for (const k of [
      "firstName",
      "gender",
      "dob",
      "phone",
      "maritalStatus",
      "currentAddress",
      "permanentAddress",
      "state",
      "district",
      "pincode",
      "residenceType",
      "aadhaar",
      "pan",
      "occupationType",
      "monthlyIncome",
      "bankName",
      "accountNumber",
      "ifsc",
      "fatherName",
      "motherName",
      "nomineeName",
      "nomineeRelation",
      "ref1Name",
      "ref1Mobile",
      "cibilScore",
    ]) {
      expect(required).toContain(k);
    }
    expect(headerLabel(COLUMN_BY_KEY.get("firstName")!)).toBe("First name *");
    expect(headerLabel(COLUMN_BY_KEY.get("lastName")!)).toBe("Last name");
  });

  it("every list column has options, and every example row value is itself valid", () => {
    for (const c of IMPORT_COLUMNS.filter((x) => x.kind === "list")) expect(c.options!.length).toBeGreaterThan(1);
    const example = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, c.example]));
    example.aadhaar = AADHAAR;
    expect(validateImportRow(example).errors).toEqual([]);
  });
});

describe("headers", () => {
  it("matches labels (with stars), keys and messy spacing, and reports what is missing or ignored", () => {
    const m = matchHeaders([
      "First name *",
      "  gender",
      "Date of birth*",
      "Mobile",
      "Favourite colour",
      "Errors",
      "Row in your file",
    ]);
    expect([...m.index.keys()]).toEqual(["firstName", "gender", "dob", "phone"]);
    expect(m.ignored).toEqual(["Favourite colour"]); // the error-file columns are silently ignored
    expect(m.missingRequired).toContain("Aadhaar number");
    expect(m.missingRequired).not.toContain("First name");
  });
  it("accepts the machine keys too", () =>
    expect(matchHeaders(["firstName", "monthlyIncome"]).index.get("monthlyIncome")).toBe(1));
});

describe("cell parsers", () => {
  it("reads dates from Excel Date objects, serial numbers and typed text", () => {
    expect(parseDate(new Date(Date.UTC(1990, 4, 15)))).toEqual({ value: "1990-05-15" });
    expect(parseDate(33_008)).toEqual({ value: "1990-05-15" }); // Excel serial for 15 May 1990
    expect(parseDate("15/05/1990")).toEqual({ value: "1990-05-15" });
    expect(parseDate("5-3-1985")).toEqual({ value: "1985-03-05" });
    expect(parseDate("1990-05-15")).toEqual({ value: "1990-05-15" });
    expect(parseDate("31/02/1990").error).toMatch(/real date/);
    expect(parseDate("yesterday").error).toBeDefined();
    expect(parseDate(-5).error).toBeDefined();
  });

  it("reads rupees to whole paise, and rejects text, negatives and sub-paise", () => {
    expect(parseRupees("35,000")).toEqual({ value: 3_500_000 });
    expect(parseRupees("₹1,234.5")).toEqual({ value: 123_450 });
    expect(parseRupees(0)).toEqual({ value: 0 });
    expect(parseRupees(19.99)).toEqual({ value: 1999 });
    expect(parseRupees("abc").error).toMatch(/rupees/);
    expect(parseRupees("-5").error).toMatch(/negative/);
    expect(parseRupees("1.234").error).toBeDefined();
  });

  it("reads whole numbers and list choices leniently", () => {
    expect(parseWhole("720")).toEqual({ value: 720 });
    expect(parseWhole(720.5).error).toBeDefined();
    expect(parseWhole("7x").error).toBeDefined();
    const occ = COLUMN_BY_KEY.get("occupationType")!;
    expect(parseOption(occ, "self employed")).toEqual({ value: "SELF_EMPLOYED" });
    expect(parseOption(occ, "SELF_EMPLOYED")).toEqual({ value: "SELF_EMPLOYED" });
    expect(parseOption(occ, " Self-Employed ")).toEqual({ value: "SELF_EMPLOYED" });
    expect(parseOption(occ, "astronaut").error).toMatch(/Choose one of: Salaried/);
  });

  it("flattens rich text, formula results and numbers", () => {
    expect(cellText({ richText: [{ text: "Anitha " }, { text: "Raman" }] })).toBe("Anitha Raman");
    expect(cellText({ formula: "A1&B1", result: "computed" })).toBe("computed");
    expect(cellText(123456789012)).toBe("123456789012");
    expect(cellText("  x  ")).toBe("x");
    expect(cellText(null)).toBe("");
  });
});

describe("validateImportRow", () => {
  it("accepts a valid row and returns wizard-ready, normalised step data", () => {
    const r = validateImportRow(good());
    expect(r.errors).toEqual([]);
    expect(r.name).toBe("Anitha Raman");
    expect(r.steps!.basic).toMatchObject({
      firstName: "Anitha",
      gender: "FEMALE",
      dob: "1990-05-15",
      phone: "9876543210",
      maritalStatus: "MARRIED",
    });
    expect(r.steps!.kyc).toMatchObject({ aadhaar: AADHAAR, pan: "ABCDE1234F" }); // upper-cased
    expect(r.steps!.employment).toMatchObject({
      occupationType: "SELF_EMPLOYED",
      monthlyIncomePaise: 3_500_000,
      additionalIncomePaise: 0,
      bank: { bankName: "State Bank of India", accountNumber: "30123456789", ifsc: "SBIN0001234" },
    });
    expect(r.steps!.references).toMatchObject({ references: [{ name: "Suresh", mobile: "9876500002" }] });
    expect(r.steps!.evaluation).toEqual({ cibilScore: 720, existingLoans: 0, monthlyEmiPaise: 0 });
    // blanks are "not provided", never empty strings
    expect(JSON.stringify(r.steps)).not.toContain('""');
  });

  it("reports every missing mandatory column at once", () => {
    const e = errorsOf({ firstName: "Only a name" });
    for (const k of [
      "gender",
      "dob",
      "phone",
      "aadhaar",
      "pan",
      "bankName",
      "accountNumber",
      "ifsc",
      "fatherName",
      "nomineeName",
      "ref1Name",
      "ref1Mobile",
      "cibilScore",
      "monthlyIncome",
    ])
      expect(e[k]).toBe("Required");
    expect(e.lastName).toBeUndefined(); // optional
    expect(e.firstName).toBeUndefined();
  });

  it("puts each format problem on its own column, with a clear message", () => {
    const e = errorsOf({
      ...good(),
      phone: "12345",
      pincode: "0123",
      aadhaar: "123456789012",
      pan: "BADPAN",
      ifsc: "XYZ",
      accountNumber: "12ab",
      cibilScore: 950,
      dob: "01/01/2015",
    });
    expect(e.phone).toMatch(/10-digit/);
    expect(e.pincode).toMatch(/pincode/i);
    expect(e.aadhaar).toBeDefined();
    expect(e.pan).toMatch(/ABCDE1234F/);
    expect(e.ifsc).toMatch(/IFSC/);
    expect(e.accountNumber).toMatch(/digits/);
    expect(e.cibilScore).toMatch(/300 to 900/);
    expect(e.dob).toMatch(/18 and 100/);
    expect(Object.keys(e).sort()).toEqual(
      ["accountNumber", "aadhaar", "cibilScore", "dob", "ifsc", "pan", "phone", "pincode"].sort(),
    );
  });

  it("reports wrong data types: text where numbers or dates belong, and unknown list values", () => {
    const e = errorsOf({
      ...good(),
      monthlyIncome: "lots",
      cibilScore: "seven hundred",
      dob: "not a date",
      gender: "Robot",
      occupationType: "Wizard",
      existingLoans: "two",
      monthlyEmi: "-5",
      additionalIncome: "x",
    });
    expect(e.monthlyIncome).toMatch(/rupees/);
    expect(e.cibilScore).toMatch(/whole number/);
    expect(e.dob).toMatch(/date/);
    expect(e.gender).toMatch(/Choose one of: Male/);
    expect(e.occupationType).toMatch(/Choose one of/);
    expect(e.existingLoans).toMatch(/whole number/);
    expect(e.monthlyEmi).toMatch(/negative/);
    expect(e.additionalIncome).toMatch(/rupees/);
  });

  it("treats a phone number typed as a number, or with a +91 prefix, as valid", () => {
    expect(validateImportRow({ ...good(), phone: 9876543210, ref1Mobile: "+91 98765 00002" }).errors).toEqual([]);
  });

  it("handles the second reference: both parts or neither", () => {
    expect(
      validateImportRow({ ...good(), ref2Name: "Mani", ref2Mobile: "9876500003" }).steps!.references,
    ).toMatchObject({ references: [{ name: "Suresh" }, { name: "Mani", mobile: "9876500003" }] });
    expect(errorsOf({ ...good(), ref2Name: "Mani" }).ref2Mobile).toBeDefined();
    expect(errorsOf({ ...good(), ref2Mobile: "9876500003" }).ref2Name).toBeDefined();
  });

  it("zero income is allowed (it just makes the customer high risk); blank optional numbers default to 0", () => {
    const r = validateImportRow({ ...good(), monthlyIncome: 0 });
    expect(r.errors).toEqual([]);
    expect(r.steps!.employment).toMatchObject({ monthlyIncomePaise: 0 });
  });

  it("blank mandatory cells made of spaces count as missing", () =>
    expect(errorsOf({ ...good(), firstName: "   " }).firstName).toBe("Required"));
});
