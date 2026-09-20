import type { INestApplication } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import request from "supertest";
import { IMPORT_COLUMNS, IMPORT_MAX_ROWS, IMPORT_TEMPLATE_VERSION, headerLabel, verhoeffAppend } from "@jana/shared";
import { ensureRoles, makeApp, makeUser, prisma, token, uniq, type TestUser } from "./helpers";

const ANY = "00000000-0000-4000-8000-000000000000";
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const rnd = (n: number) => Array.from(randomBytes(n), (b) => b % 10).join("");
const letters = (n: number) => Array.from(randomBytes(n), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ"[b % 24]).join("");
const word = () => randomBytes(4).toString("hex");
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

type Row = Record<string, unknown>;

/** A fully valid customer row (keyed by column key) with unique phone, Aadhaar and PAN. */
function good(over: Row = {}): Row {
  return {
    firstName: `Imp${word()}`,
    lastName: word(),
    gender: "Female",
    dob: "15/05/1990",
    phone: `9${rnd(9)}`,
    maritalStatus: "Married",
    currentAddress: "12 Gandhi Road",
    permanentAddress: "12 Gandhi Road",
    state: "Tamil Nadu",
    district: "Kanchipuram",
    pincode: "631501",
    residenceType: "Own",
    aadhaar: verhoeffAppend(`${2 + (randomBytes(1)[0]! % 8)}${rnd(10)}`),
    pan: `${letters(5)}${rnd(4)}${letters(1)}`,
    occupationType: "Salaried",
    monthlyIncome: 35000,
    bankName: "State Bank of India",
    accountNumber: `3${rnd(10)}`,
    ifsc: "SBIN0001234",
    fatherName: "Raman",
    motherName: "Lakshmi",
    nomineeName: "Kumar",
    nomineeRelation: "Spouse",
    ref1Name: "Suresh",
    ref1Mobile: `9${rnd(9)}`,
    cibilScore: 720,
    ...over,
  };
}

describe("bulk customer import", () => {
  let app: INestApplication;
  let admin: TestUser;
  let adminH: { Authorization: string };
  let staffH: { Authorization: string };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await makeApp();
    await ensureRoles();
    admin = await makeUser(app, "super_admin", { totp: true });
    adminH = await token(app, admin);
    staffH = await token(app, await makeUser(app, "staff"));
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /* ---------- helpers ---------- */

  const template = async () =>
    Buffer.from((await http().get("/customers/import/template").set(adminH).buffer(true).parse(binary)).body as Buffer);
  function binary(res: request.Response, cb: (e: Error | null, b: Buffer) => void) {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  }

  /** Fill the REAL downloaded template with rows, exactly as a user's Excel would (text, numbers and dates). */
  async function fill(rows: Row[], tweak?: (wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet) => void): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await template()) as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("Customers")!;
    rows.forEach((r, i) => {
      if (r === null) return; // a deliberately blank row
      IMPORT_COLUMNS.forEach((c, ci) => {
        if (r[c.key] !== undefined) ws.getCell(i + 2, ci + 1).value = r[c.key] as ExcelJS.CellValue;
      });
    });
    tweak?.(wb, ws);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  const validate = (file: Buffer | string, name = "customers.xlsx", h = adminH) =>
    http()
      .post("/customers/import/validate")
      .set(h)
      .attach("file", Buffer.isBuffer(file) ? file : Buffer.from(file), name);
  const run = (id: string, body: object = {}, h = adminH) =>
    http().post(`/customers/import/batches/${id}/run`).set(h).send(body);
  const errorsFile = async (id: string, which = "errors") =>
    (
      await http()
        .get(`/customers/import/batches/${id}/errors`)
        .query({ rows: which })
        .set(adminH)
        .buffer(true)
        .parse(binary)
    ).body as Buffer;

  async function readSheet(buf: Buffer, name = "Customers") {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    return { wb, ws: wb.getWorksheet(name)! };
  }

  /* ---------- access ---------- */

  describe("permissions", () => {
    const endpoints: { method: "get" | "post" | "delete"; path: string }[] = [
      { method: "get", path: "/customers/import/template" },
      { method: "post", path: "/customers/import/validate" },
      { method: "get", path: "/customers/import/batches" },
      { method: "get", path: `/customers/import/batches/${ANY}` },
      { method: "get", path: `/customers/import/batches/${ANY}/errors` },
      { method: "post", path: `/customers/import/batches/${ANY}/run` },
      { method: "delete", path: `/customers/import/batches/${ANY}` },
    ];
    describe.each(endpoints)("$method $path", ({ method, path }) => {
      it("401 without a token", async () => expect((await http()[method](path)).status).toBe(401));
      it("403 for staff, who cannot import", async () =>
        expect((await http()[method](path).set(staffH).send({})).status).toBe(403));
    });

    it("needs customer:create and kyc:upload as well, since it writes customers and KYC numbers", async () => {
      const role = await prisma.role.create({
        data: { name: `imp-${word()}`, permissions: ["customer:import", "customer:view"] },
      });
      const u = await makeUser(app, "staff");
      await prisma.user.update({ where: { id: u.id }, data: { roleId: role.id } });
      const h = await token(app, u);
      expect((await http().get("/customers/import/template").set(h)).status).toBe(200);
      expect((await validate(await fill([good()]), "c.xlsx", h)).status).toBe(403);
    });
  });

  /* ---------- the template ---------- */

  describe("template", () => {
    it("is an Excel workbook with instructions, marked mandatory columns, dropdowns and text-safe columns", async () => {
      const res = await http().get("/customers/import/template").set(adminH).buffer(true).parse(binary);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe(XLSX_TYPE);
      expect(res.headers["content-disposition"]).toContain("attachment");
      const { wb, ws } = await readSheet(res.body as Buffer);

      expect(wb.worksheets.map((s) => s.name)).toEqual(["Instructions", "Customers", "Lists", "_meta"]);
      expect(wb.getWorksheet("Lists")!.state).toBe("hidden");
      expect(wb.getWorksheet("_meta")!.getCell("B1").value).toBe(IMPORT_TEMPLATE_VERSION);

      // headers exactly as defined, with a star on every mandatory one
      const headers = IMPORT_COLUMNS.map((_c, i) => String(ws.getCell(1, i + 1).value));
      expect(headers).toEqual(IMPORT_COLUMNS.map(headerLabel));
      expect(headers.filter((h) => h.endsWith("*")).length).toBe(IMPORT_COLUMNS.filter((c) => c.required).length);

      // sensitive number columns are text, so Excel cannot mangle 12-digit numbers
      const col = (k: string) => IMPORT_COLUMNS.findIndex((c) => c.key === k) + 1;
      for (const k of ["aadhaar", "phone", "accountNumber", "pincode", "pan"])
        expect(ws.getColumn(col(k)).numFmt).toBe("@");
      expect(ws.getColumn(col("dob")).numFmt).toBe("dd/mm/yyyy");

      // dropdowns and number rules cover every data row of the column, and nothing beyond it
      const rule = (k: string, row: number) =>
        ws.getCell(row, col(k)).dataValidation as { type?: string; formulae?: unknown[] } | undefined;
      for (const row of [2, 500, IMPORT_MAX_ROWS + 1]) {
        expect(rule("gender", row)?.type).toBe("list");
        expect(rule("occupationType", row)?.type).toBe("list");
        expect(rule("cibilScore", row)).toMatchObject({ type: "whole", formulae: [300, 900] });
        expect(rule("dob", row)?.type).toBe("date");
        expect(rule("monthlyIncome", row)?.type).toBe("decimal");
      }
      expect(rule("gender", IMPORT_MAX_ROWS + 2)).toBeUndefined();
      expect(rule("firstName", 2)).toBeUndefined(); // plain text columns are not restricted

      // every column is explained on the instructions sheet
      const text = JSON.stringify(wb.getWorksheet("Instructions")!.getSheetValues());
      for (const c of IMPORT_COLUMNS) expect(text).toContain(c.header);
      expect(text).toContain("Photos and scanned documents");
    });
  });

  /* ---------- checking a file ---------- */

  describe("validation", () => {
    it("sorts rows into ready, errors and duplicates with exact row numbers, and saves nothing", async () => {
      const existing = await http().post("/customers").set(adminH).send({});
      const existingPhone = `9${rnd(9)}`;
      await http()
        .patch(`/customers/${existing.body.id}/steps/basic`)
        .set(adminH)
        .send({ firstName: "Already", lastName: "There", phone: existingPhone });

      const first = good();
      const rows: (Row | null)[] = [
        first, //                                     row 2 ready
        good(), //                                    row 3 ready
        { firstName: "Only a name" }, //              row 4 missing everything else
        good({
          phone: "12345",
          pincode: "abc",
          cibilScore: "high",
          dob: "31/02/1990",
          gender: "Robot",
          monthlyIncome: "lots",
        }), // row 5 wrong types and values
        null, //                                      row 6 blank: skipped
        good({ phone: existingPhone }), //            row 7 duplicate of an existing customer
        good({ aadhaar: first.aadhaar, phone: first.phone }), // row 8 repeats row 2 inside the file
      ];
      const before = await prisma.customer.count();
      const res = await validate(await fill(rows as Row[]));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 6, ready: 2, errors: 2, duplicates: 2, ignoredColumns: [] });
      const by = (n: number) => res.body.rows.find((r: { row: number }) => r.row === n);
      expect(by(2)).toMatchObject({ status: "ready", errors: [] });
      expect(by(4).status).toBe("error");
      const cols4 = by(4).errors.map((e: { column: string }) => e.column);
      for (const k of [
        "gender",
        "dob",
        "phone",
        "aadhaar",
        "pan",
        "bankName",
        "ifsc",
        "cibilScore",
        "monthlyIncome",
        "ref1Name",
      ])
        expect(cols4).toContain(k);
      expect(by(4).errors.find((e: { column: string }) => e.column === "phone")).toMatchObject({
        header: "Mobile",
        message: "Required",
      });

      const e5 = Object.fromEntries(
        by(5).errors.map((e: { column: string; message: string }) => [e.column, e.message]),
      );
      expect(e5.phone).toMatch(/10-digit/);
      expect(e5.pincode).toMatch(/pincode/i);
      expect(e5.cibilScore).toMatch(/whole number/);
      expect(e5.dob).toMatch(/real date/);
      expect(e5.gender).toMatch(/Choose one of/);
      expect(e5.monthlyIncome).toMatch(/rupees/);

      expect(by(7)).toMatchObject({ status: "duplicate" });
      expect(by(7).duplicates[0]).toMatchObject({ name: "Already There", reasons: ["Same mobile number"] });
      expect(by(8).status).toBe("duplicate");
      expect(by(8).duplicates.map((d: { name: string }) => d.name)).toContain("Row 2 in this file");
      expect(res.body.rows.map((r: { row: number }) => r.row)).not.toContain(6);

      expect(await prisma.customer.count()).toBe(before); // nothing was created
      expect(json(res.body)).not.toContain(String(first.aadhaar)); // the report never carries ID numbers
    });

    it("holds the rows encrypted, with no ID, bank or name data readable in the database", async () => {
      const row = good();
      const res = await validate(await fill([row]));
      const b = await prisma.importBatch.findUniqueOrThrow({ where: { id: res.body.batchId } });
      expect(b.dataEnc).toMatch(/^v1\./);
      for (const secret of [row.aadhaar, row.pan, row.accountNumber, row.firstName, row.phone])
        expect(json(b)).not.toContain(String(secret));
      expect(b.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
      expect(
        await prisma.auditLog.findFirst({ where: { entityId: b.id, action: "customer.import_validated" } }),
      ).toBeTruthy();
      expect(json(await prisma.auditLog.findMany({ where: { entityId: b.id } }))).not.toContain(String(row.aadhaar));
    });

    it("accepts the ways real spreadsheets store values: dates, numeric cells, spaces and mixed case", async () => {
      const r = good({
        dob: new Date(Date.UTC(1988, 2, 9)), //          a real Excel date cell
        phone: Number(`9${rnd(9)}`), //                  phone typed as a number
        aadhaar: Number(verhoeffAppend(`${2 + (randomBytes(1)[0]! % 8)}${rnd(10)}`)), // Aadhaar typed as a number
        pan: ` ${`${letters(5)}${rnd(4)}${letters(1)}`.toLowerCase()} `,
        gender: "female",
        occupationType: "self employed",
        monthlyIncome: "₹35,000.50",
        ifsc: "sbin0001234",
        pincode: 631501, //                              pincode as a number
        ref1Mobile: `+91 9${rnd(4)} ${rnd(5)}`,
        cibilScore: "720",
      });
      const res = await validate(await fill([r]));
      expect(res.body.rows[0]).toMatchObject({ status: "ready", errors: [] });
    });

    it("ignores unknown columns but tells the user, and treats a formula's shown result as the value", async () => {
      const buf = await fill([good()], (_wb, ws) => {
        ws.getCell(1, IMPORT_COLUMNS.length + 1).value = "Favourite colour";
        ws.getCell(2, IMPORT_COLUMNS.length + 1).value = "blue";
        ws.getCell(2, 1).value = { formula: '"Anitha"&""', result: "Anitha" };
      });
      const res = await validate(buf);
      expect(res.body.ignoredColumns).toEqual(["Favourite colour"]);
      expect(res.body.rows[0]).toMatchObject({ name: expect.stringContaining("Anitha"), status: "ready" });
    });

    it("also accepts a CSV with the same headers", async () => {
      const r = good();
      const head = IMPORT_COLUMNS.map((c) => c.header).join(",");
      const line = IMPORT_COLUMNS.map((c) => JSON.stringify(String(r[c.key] ?? ""))).join(",");
      const res = await validate(`${head}\n${line}\n`, "customers.csv");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 1, ready: 1 });
    });
  });

  /* ---------- rejected files ---------- */

  describe("file checks", () => {
    const code = async (file: Buffer | string, name: string) => (await validate(file, name)).body.code;

    it("rejects the wrong kind of file with a friendly explanation", async () => {
      expect(await code("hello", "notes.txt")).toBe("UNSUPPORTED_FILE");
      expect(await code("hello", "old.xls")).toBe("UNSUPPORTED_FILE");
      expect(await code("hello", "macro.xlsm")).toBe("UNSUPPORTED_FILE");
      expect(await code("this is not a zip", "fake.xlsx")).toBe("UNSUPPORTED_FILE");
      expect((await http().post("/customers/import/validate").set(adminH)).body.code).toBe("NO_FILE");
    });

    it("rejects a zip that is not a workbook, and a workbook containing macros", async () => {
      const zip = new JSZip();
      zip.file("readme.txt", "hi");
      expect(await code(Buffer.from(await zip.generateAsync({ type: "uint8array" })), "x.xlsx")).toBe(
        "UNSUPPORTED_FILE",
      );

      const macro = await JSZip.loadAsync(await fill([good()]));
      macro.file("xl/vbaProject.bin", "evil");
      const res = await validate(Buffer.from(await macro.generateAsync({ type: "uint8array" })), "macro.xlsx");
      expect(res.body.code).toBe("UNSUPPORTED_FILE");
      expect(res.body.message).toMatch(/macros/);
    });

    it("rejects an empty sheet, a missing mandatory column, an unrelated workbook and an outdated template", async () => {
      expect(await code(await fill([]), "empty.xlsx")).toBe("EMPTY_FILE");

      const missing = await validate(
        await fill(
          [good()],
          (_wb, ws) => (ws.getCell(1, IMPORT_COLUMNS.findIndex((c) => c.key === "aadhaar") + 1).value = "Renamed"),
        ),
      );
      expect(missing.body.code).toBe("MISSING_COLUMNS");
      expect(missing.body.message).toContain("Aadhaar number");

      const other = new ExcelJS.Workbook();
      other.addWorksheet("Sheet1").addRow(["name", "amount"]);
      expect(await code(Buffer.from(await other.xlsx.writeBuffer()), "other.xlsx")).toBe("NOT_THE_TEMPLATE");

      const old = await validate(await fill([good()], (wb) => (wb.getWorksheet("_meta")!.getCell("B1").value = "0")));
      expect(old.body.code).toBe("OLD_TEMPLATE");
    });

    it("rejects too many rows and oversize files", async () => {
      const many = Array.from({ length: IMPORT_MAX_ROWS + 1 }, () => ({ firstName: "x" }));
      expect((await validate(await fill(many))).body.code).toBe("TOO_MANY_ROWS");
      const big = Buffer.alloc(5 * 1024 * 1024 + 10, 65);
      expect((await validate(big, "big.xlsx")).status).toBe(413);
    });
  });

  /* ---------- fix and re-upload ---------- */

  describe("rows to fix", () => {
    it("downloads only the failed rows in template layout with reasons, and the corrected file goes straight through", async () => {
      const okRow = good();
      const badRow = good({ phone: "123", pan: "BAD", cibilScore: 1000, firstName: '=HYPERLINK("http://evil")' });
      const missing = good({ ifsc: undefined, bankName: undefined });
      const res = await validate(await fill([okRow, badRow, missing]));
      expect(res.body).toMatchObject({ ready: 1, errors: 2 });

      const fixFile = await errorsFile(res.body.batchId);
      const { wb, ws } = await readSheet(fixFile);
      expect(wb.getWorksheet("Instructions")!.getCell("A1").value).toBe("Rows to fix");
      // same layout as the template, plus the two extra columns at the end
      const n = IMPORT_COLUMNS.length;
      expect(String(ws.getCell(1, 1).value)).toBe("First name *");
      expect(ws.getCell(1, n + 1).value).toBe("Row in your file");
      expect(ws.getCell(1, n + 2).value).toBe("Errors");
      // only the two failed rows, with their original row numbers (3 and 4) and every problem listed
      expect([ws.getCell(2, n + 1).value, ws.getCell(3, n + 1).value]).toEqual([3, 4]);
      const errs = String(ws.getCell(2, n + 2).value);
      expect(errs).toContain("Mobile:");
      expect(errs).toContain("PAN:");
      expect(errs).toContain("CIBIL score: Must be at most 900".replace("Must be at most 900", "300 to 900"));
      expect(String(ws.getCell(3, n + 2).value)).toContain("Bank name: Required");
      // the offending cells are highlighted, good cells are not
      const phoneCol = IMPORT_COLUMNS.findIndex((c) => c.key === "phone") + 1;
      const lastCol = IMPORT_COLUMNS.findIndex((c) => c.key === "lastName") + 1;
      expect((ws.getCell(2, phoneCol).fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFFDE2E2");
      expect((ws.getCell(2, lastCol).fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb).not.toBe("FFFDE2E2");
      // text starting with = is neutralised so it cannot run as a formula when opened
      expect(String(ws.getCell(2, 1).value).startsWith("'=")).toBe(true);
      // the user's original values are preserved for correction
      expect(String(ws.getCell(2, IMPORT_COLUMNS.findIndex((c) => c.key === "aadhaar") + 1).value)).toBe(
        String(badRow.aadhaar),
      );

      // Correct it (leave the extra columns in place) and upload again
      ws.getCell(2, 1).value = "Corrected";
      ws.getCell(2, phoneCol).value = `9${rnd(9)}`;
      ws.getCell(2, IMPORT_COLUMNS.findIndex((c) => c.key === "pan") + 1).value = `${letters(5)}${rnd(4)}${letters(1)}`;
      ws.getCell(2, IMPORT_COLUMNS.findIndex((c) => c.key === "cibilScore") + 1).value = 700;
      ws.getCell(3, IMPORT_COLUMNS.findIndex((c) => c.key === "bankName") + 1).value = "Indian Bank";
      ws.getCell(3, IMPORT_COLUMNS.findIndex((c) => c.key === "ifsc") + 1).value = "IDIB000K123";
      const second = await validate(Buffer.from(await wb.xlsx.writeBuffer()), "fixed.xlsx");
      expect(second.body).toMatchObject({ total: 2, ready: 2, errors: 0, duplicates: 0, ignoredColumns: [] });
    });

    it("has nothing to download when every row is fine", async () => {
      const res = await validate(await fill([good()]));
      expect((await http().get(`/customers/import/batches/${res.body.batchId}/errors`).set(adminH)).body.code).toBe(
        "NOTHING_TO_FIX",
      );
    });

    it("gives a separate file for possible duplicates, and imports them only when asked", async () => {
      const existing = good();
      const one = await validate(await fill([existing]));
      await run(one.body.batchId);
      const dup = good({ phone: existing.phone });
      const res = await validate(await fill([dup]));
      expect(res.body).toMatchObject({ ready: 0, duplicates: 1 });
      const { ws } = await readSheet(await errorsFile(res.body.batchId, "duplicates"));
      expect(String(ws.getCell(2, IMPORT_COLUMNS.length + 2).value)).toContain("Possible duplicate");

      const skipped = await run(res.body.batchId);
      expect(skipped.body).toMatchObject({ imported: 0, skippedDuplicates: 1 });

      const again = await validate(await fill([good({ phone: existing.phone })]));
      const forced = await run(again.body.batchId, { includeDuplicates: true });
      expect(forced.body.imported).toBe(1);
    });
  });

  /* ---------- importing ---------- */

  describe("import", () => {
    it("creates complete DRAFT customers with encrypted numbers, and never records consent for the customer", async () => {
      const a = good();
      const b = good({
        occupationType: "Business",
        monthlyIncome: 0,
        cibilScore: 640,
        ref2Name: "Mani",
        ref2Mobile: `9${rnd(9)}`,
      });
      const res = await validate(await fill([a, b, good({ phone: "1" })]));
      expect(res.body).toMatchObject({ ready: 2, errors: 1 });

      const done = await run(res.body.batchId);
      expect(done.status).toBe(200);
      expect(done.body).toMatchObject({ imported: 2, skippedErrors: 1, skippedDuplicates: 0, failed: 0 });
      expect(done.body.codes).toHaveLength(2);

      const custs = await prisma.customer.findMany({
        where: { code: { in: done.body.codes } },
        include: { documents: true, bank: true, references: true },
        orderBy: { code: "asc" },
      });
      for (const c of custs) {
        expect(c.status).toBe("DRAFT");
        expect(c.completedSteps.sort()).toEqual(
          ["address", "basic", "evaluation", "employment", "kyc", "references"].sort(),
        );
        expect(c.consentAt).toBeNull();
        expect(c.bank).toHaveLength(1);
        expect(c.documents.find((d) => d.type === "AADHAAR")!.numberEnc).toMatch(/^v1\./);
      }
      const first = custs.find((c) => c.firstName === a.firstName)!;
      expect(first).toMatchObject({
        gender: "FEMALE",
        maritalStatus: "MARRIED",
        occupationType: "SALARIED",
        district: "Kanchipuram",
        cibilScore: 720,
      });
      expect(first.dob?.toISOString().slice(0, 10)).toBe("1990-05-15");
      expect(Number(first.monthlyIncomePaise)).toBe(3_500_000);
      expect(first.riskLevel).not.toBeNull(); // evaluation was computed
      const second = custs.find((c) => c.firstName === b.firstName)!;
      expect(second.references).toHaveLength(2);
      expect(second.riskLevel).toBe("HIGH"); // zero income

      // the numbers are right (revealed through the audited endpoint) and consent is still needed to activate
      expect(
        (await http().post(`/customers/${first.id}/reveal`).set(adminH).send({ field: "AADHAAR" })).body.value,
      ).toBe(String(a.aadhaar));
      const submit = await http()
        .post(`/customers/${first.id}/submit`)
        .set(adminH)
        .send({ acknowledgeDuplicates: true });
      expect(submit.body).toMatchObject({ code: "INCOMPLETE", consentMissing: true, missing: [] });
      const list = await http()
        .get("/customers")
        .query({ status: "DRAFT", q: String(a.firstName) })
        .set(adminH);
      expect(list.body.items[0]).toMatchObject({ consentGiven: false });

      // consent is recorded in the wizard, then it can be activated
      const consent = await http()
        .patch(`/customers/${first.id}/steps/evaluation`)
        .set(adminH)
        .send({ consentGiven: true });
      expect(consent.status).toBe(200);
      expect(
        (await http().post(`/customers/${first.id}/submit`).set(adminH).send({ acknowledgeDuplicates: true })).body
          .status,
      ).toBe("ACTIVE");

      // traceable, without PII
      expect(await prisma.auditLog.count({ where: { entityId: first.id, action: "customer.bulk_imported" } })).toBe(1);
      const batchAudit = json(await prisma.auditLog.findMany({ where: { entityId: res.body.batchId } }));
      expect(batchAudit).toContain('"imported":2');
      expect(batchAudit).not.toContain(String(a.aadhaar));
    });

    it("cannot be run twice, clears imported data, and keeps only the rows still to fix", async () => {
      const res = await validate(await fill([good(), good({ phone: "1" })]));
      await run(res.body.batchId);
      expect((await run(res.body.batchId)).body.code).toBe("ALREADY_IMPORTED");

      const b = await prisma.importBatch.findUniqueOrThrow({ where: { id: res.body.batchId } });
      expect(b).toMatchObject({ status: "IMPORTED", importedRows: 1, errorRows: 1, readyRows: 1 });
      // what is left is only the failed row, so an imported customer's numbers no longer sit in the batch
      const stillFixable = await errorsFile(res.body.batchId);
      expect((await readSheet(stillFixable)).ws.rowCount).toBe(2);

      const allGood = await validate(await fill([good()]));
      await run(allGood.body.batchId);
      expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: allGood.body.batchId } })).dataEnc).toBeNull();
    });

    it("keeps one uploader's batch private, but lets the Super Admin see it", async () => {
      const role = await prisma.role.create({
        data: {
          name: `imp2-${word()}`,
          permissions: ["customer:import", "customer:create", "kyc:upload", "customer:view"],
        },
      });
      const other = await makeUser(app, "staff");
      await prisma.user.update({ where: { id: other.id }, data: { roleId: role.id } });
      const oh = await token(app, other);

      const res = await validate(await fill([good(), good({ phone: "1" })]), "mine.xlsx", oh);
      expect(res.status).toBe(200);
      expect((await run(res.body.batchId, {}, adminH)).status).toBe(200); // Super Admin may
      const res2 = await validate(await fill([good()]), "mine2.xlsx", oh);
      // a different non-owner may not
      const third = await makeUser(app, "staff");
      await prisma.user.update({ where: { id: third.id }, data: { roleId: role.id } });
      expect((await run(res2.body.batchId, {}, await token(app, third))).status).toBe(403);
      expect(
        (
          await http()
            .get(`/customers/import/batches/${res2.body.batchId}/errors`)
            .set(await token(app, third))
        ).status,
      ).toBe(403);

      const mine = (await http().get("/customers/import/batches").set(oh)).body as { id: string }[];
      expect(mine.map((b) => b.id)).toContain(res2.body.batchId);
      expect(
        (
          await http()
            .get("/customers/import/batches")
            .set(await token(app, third))
        ).body.map((b: { id: string }) => b.id),
      ).not.toContain(res2.body.batchId);
    });

    it("expires after 24 hours: the data is removed and the batch can no longer be imported or downloaded", async () => {
      const res = await validate(await fill([good(), good({ phone: "1" })]));
      await prisma.importBatch.update({
        where: { id: res.body.batchId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const r = await run(res.body.batchId);
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/expired/);
      const b = await prisma.importBatch.findUniqueOrThrow({ where: { id: res.body.batchId } });
      expect(b).toMatchObject({ status: "EXPIRED", dataEnc: null });
      expect((await http().get(`/customers/import/batches/${res.body.batchId}/errors`).set(adminH)).body.code).toBe(
        "EXPIRED",
      );
    });

    it("can be discarded, after which it cannot be imported", async () => {
      const res = await validate(await fill([good()]));
      expect((await http().delete(`/customers/import/batches/${res.body.batchId}`).set(adminH)).status).toBe(204);
      expect(await prisma.importBatch.findUniqueOrThrow({ where: { id: res.body.batchId } })).toMatchObject({
        status: "DISCARDED",
        dataEnc: null,
      });
      expect((await run(res.body.batchId)).body.code).toBe("ALREADY_IMPORTED");
    });

    it("handles a few hundred rows in reasonable time", async () => {
      const rows = Array.from({ length: 150 }, () => good());
      const t0 = Date.now();
      const res = await validate(await fill(rows));
      expect(res.body).toMatchObject({ total: 150, ready: 150 });
      const done = await run(res.body.batchId);
      expect(done.body.imported).toBe(150);
      expect(Date.now() - t0).toBeLessThan(60_000);
      expect(await prisma.customer.count({ where: { code: { in: done.body.codes }, status: "DRAFT" } })).toBe(150);
    }, 90_000);

    it("re-opens a held batch with the same report, and refuses someone else's", async () => {
      const res = await validate(await fill([good(), good({ phone: "1" })]));
      const again = await http().get(`/customers/import/batches/${res.body.batchId}`).set(adminH);
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({
        batchId: res.body.batchId,
        total: 2,
        ready: 1,
        errors: 1,
        status: "VALIDATED",
      });
      expect(again.body.rows).toEqual(res.body.rows);
      expect((await http().get(`/customers/import/batches/${ANY}`).set(adminH)).status).toBe(404);
    });

    it("re-opens a fully imported batch as a finished result, not an error", async () => {
      const res = await validate(await fill([good()]));
      await run(res.body.batchId);
      const again = await http().get(`/customers/import/batches/${res.body.batchId}`).set(adminH);
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({
        status: "IMPORTED",
        imported: 1,
        total: 1,
        errors: 0,
        duplicates: 0,
        rows: [],
      });
    });

    it("lists recent imports with counts and what can still be done", async () => {
      const res = await validate(await fill([good(), good({ phone: "1" })]), "list-me.xlsx");
      const list = (await http().get("/customers/import/batches").set(adminH)).body as Record<string, unknown>[];
      const mine = list.find((b) => b.id === res.body.batchId)!;
      expect(mine).toMatchObject({
        fileName: "list-me.xlsx",
        status: "VALIDATED",
        total: 2,
        ready: 1,
        errors: 1,
        canImport: true,
        errorFileAvailable: true,
      });
      expect(uniq("x")).toBeTruthy();
    });
  });
});
