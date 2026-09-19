import type { INestApplication } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { verhoeffAppend } from "@jana/shared";
import { parseCsv, safeCell, toCsv } from "../src/customers/csv";
import { ensureRoles, makeApp, makeUser, prisma, token } from "./helpers";

const ANY_ID = "00000000-0000-4000-8000-000000000000";
const rnd = (n: number) => Array.from(randomBytes(n), (b) => b % 10).join("");
const word = () => randomBytes(5).toString("hex");
const phone = () => `9${rnd(9)}`;
const letters = () => Array.from(randomBytes(5), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ"[b % 24]).join("");
const pan = () => `${letters()}${rnd(4)}${letters()[0]}`;
const aadhaar = () => verhoeffAppend(`${2 + (randomBytes(1)[0]! % 8)}${rnd(10)}`);
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

describe("csv utilities", () => {
  it("parses quotes, embedded commas/newlines, CRLF and a BOM", () => {
    const rows = parseCsv('﻿a,b,c\r\n"x, y","line1\nline2","he said ""hi"""\r\n\r\n1,2,3');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["x, y", "line1\nline2", 'he said "hi"'],
      ["1", "2", "3"],
    ]);
  });

  it("neutralises spreadsheet formulas but leaves numbers alone", () => {
    expect(safeCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(safeCell("+91 98765")).toBe("'+91 98765");
    expect(safeCell("@cmd")).toBe("'@cmd");
    expect(safeCell("-5")).toBe("-5");
    expect(safeCell("normal")).toBe("normal");
    expect(safeCell('a,"b"')).toBe('"a,""b"""');
    expect(toCsv([["a", "=1+1"]])).toBe("a,'=1+1\r\n");
  });
});

describe("customer extras", () => {
  let app: INestApplication;
  let adminH: { Authorization: string };
  let staffH: { Authorization: string };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await makeApp();
    await ensureRoles();
    adminH = await token(app, await makeUser(app, "super_admin", { totp: true }));
    staffH = await token(app, await makeUser(app, "staff"));
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /** A submitted-looking customer: only the fields these tests need. */
  async function makeCustomer(over: { firstName?: string; phoneNo?: string; aadhaarNo?: string } = {}) {
    const c = await http().post("/customers").set(adminH).send({});
    const id = c.body.id as string;
    await http()
      .patch(`/customers/${id}/steps/basic`)
      .set(adminH)
      .send({
        firstName: over.firstName ?? word(),
        lastName: word(),
        gender: "MALE",
        dob: "1990-01-01",
        phone: over.phoneNo ?? phone(),
        maritalStatus: "SINGLE",
      });
    if (over.aadhaarNo) await http().patch(`/customers/${id}/steps/kyc`).set(adminH).send({ aadhaar: over.aadhaarNo });
    return id;
  }

  describe("permissions", () => {
    const endpoints: { method: "get" | "post" | "patch"; path: string }[] = [
      { method: "get", path: "/customers/follow-ups" },
      { method: "get", path: "/customers/export" },
      { method: "get", path: "/customers/import/template" },
      { method: "post", path: "/customers/import" },
      { method: "get", path: `/customers/${ANY_ID}/notes` },
      { method: "post", path: `/customers/${ANY_ID}/notes` },
      { method: "post", path: `/customers/${ANY_ID}/notes/${ANY_ID}/complete` },
      { method: "patch", path: `/customers/${ANY_ID}/tags` },
      { method: "post", path: `/customers/${ANY_ID}/watch` },
    ];
    describe.each(endpoints)("$method $path", ({ method, path }) => {
      it("401 without a token", async () => expect((await http()[method](path)).status).toBe(401));
      it("403 without the permission", async () => {
        const role = await prisma.role.create({ data: { name: `np-${word()}`, permissions: ["audit:view"] } });
        const u = await makeUser(app, "staff");
        await prisma.user.update({ where: { id: u.id }, data: { roleId: role.id } });
        expect(
          (
            await http()
              [method](path)
              .set(await token(app, u))
              .send({})
          ).status,
        ).toBe(403);
      });
    });

    it("plain staff can add notes but cannot export, import or blacklist", async () => {
      const id = await makeCustomer();
      expect((await http().post(`/customers/${id}/notes`).set(staffH).send({ body: "called" })).status).toBe(201);
      expect((await http().get("/customers/export").set(staffH)).status).toBe(403);
      expect((await http().post("/customers/import").set(staffH)).status).toBe(403);
      expect(
        (
          await http()
            .post(`/customers/${id}/watch`)
            .set(staffH)
            .send({ status: "BLACKLIST", reason: "fraud suspected" })
        ).status,
      ).toBe(403);
    });
  });

  describe("notes and follow-ups", () => {
    it("records call notes with outcome, and follow-ups show as due until completed", async () => {
      const id = await makeCustomer();
      const today = new Date().toISOString().slice(0, 10);
      const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

      const due = await http()
        .post(`/customers/${id}/notes`)
        .set(staffH)
        .send({ kind: "CALL", body: "Spoke to customer", outcome: "Promised to pay on 25th", followUpOn: today });
      expect(due.status).toBe(201);
      expect(due.body).toMatchObject({
        kind: "CALL",
        outcome: "Promised to pay on 25th",
        authorName: expect.any(String),
      });
      const later = await http()
        .post(`/customers/${id}/notes`)
        .set(staffH)
        .send({ body: "Remind after festival", followUpOn: future });

      const list = await http().get(`/customers/${id}/notes`).set(staffH);
      expect(list.body).toHaveLength(2);

      let tasks = (await http().get("/customers/follow-ups").set(staffH)).body as {
        id: string;
        customer: { id: string };
      }[];
      expect(tasks.filter((t) => t.customer.id === id).map((t) => t.id)).toEqual([due.body.id]); // the future one is not due yet
      expect(
        (await http().get("/customers/follow-ups").query({ upTo: future }).set(staffH)).body.filter(
          (t: { customer: { id: string } }) => t.customer.id === id,
        ),
      ).toHaveLength(2);

      expect(
        (await http().post(`/customers/${id}/notes/${due.body.id}/complete`).set(staffH)).body.completedAt,
      ).toBeTruthy();
      tasks = (await http().get("/customers/follow-ups").set(staffH)).body;
      expect(tasks.filter((t) => t.customer.id === id)).toHaveLength(0);
      expect(
        (await http().post(`/customers/${id}/notes/${due.body.id}/complete`).set(staffH)).body.completedAt,
      ).toBeNull(); // toggles back

      const plain = await http().post(`/customers/${id}/notes`).set(staffH).send({ body: "just a note" });
      expect((await http().post(`/customers/${id}/notes/${plain.body.id}/complete`).set(staffH)).body.code).toBe(
        "NOT_A_TASK",
      );
      expect(later.status).toBe(201);
    });

    it("validates input and hides deleted customers' tasks", async () => {
      const id = await makeCustomer();
      expect((await http().post(`/customers/${id}/notes`).set(staffH).send({ body: "  " })).status).toBe(400);
      expect(
        (await http().post(`/customers/${id}/notes`).set(staffH).send({ body: "x", followUpOn: "tomorrow" })).status,
      ).toBe(400);
      expect((await http().post(`/customers/${id}/notes`).set(staffH).send({ body: "x", kind: "EMAIL" })).status).toBe(
        400,
      );
      await http().post(`/customers/${id}/notes`).set(staffH).send({ body: "chase", followUpOn: "2020-01-01" });
      await http().delete(`/customers/${id}`).set(adminH);
      const tasks = (await http().get("/customers/follow-ups").set(staffH)).body as { customer: { id: string } }[];
      expect(tasks.some((t) => t.customer.id === id)).toBe(false);
    });
  });

  describe("tags and watch status", () => {
    it("normalises tags, filters by tag, and caps the count", async () => {
      const id = await makeCustomer();
      const tag = `vip-${word()}`;
      const r = await http()
        .patch(`/customers/${id}/tags`)
        .set(staffH)
        .send({ tags: [` ${tag} `, tag, "referred"] });
      expect(r.body.tags).toEqual([tag, "referred"]);
      expect(
        (await http().get("/customers").query({ tag, status: "DRAFT" }).set(staffH)).body.items.map(
          (i: { id: string }) => i.id,
        ),
      ).toEqual([id]);
      expect(
        (
          await http()
            .patch(`/customers/${id}/tags`)
            .set(staffH)
            .send({ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })
        ).status,
      ).toBe(400);
    });

    it("blacklisting needs a reason, is audited, filterable and reversible", async () => {
      const id = await makeCustomer();
      expect((await http().post(`/customers/${id}/watch`).set(adminH).send({ status: "BLACKLIST" })).status).toBe(400);
      expect(
        (await http().post(`/customers/${id}/watch`).set(adminH).send({ status: "BLACKLIST", reason: "bad" })).status,
      ).toBe(400);

      const r = await http()
        .post(`/customers/${id}/watch`)
        .set(adminH)
        .send({ status: "BLACKLIST", reason: "Cheque bounced twice, loan defaulted" });
      expect(r.body.watch).toMatchObject({ status: "BLACKLIST", reason: "Cheque bounced twice, loan defaulted" });
      expect(
        (await http().get("/customers").query({ watch: "BLACKLIST", status: "DRAFT" }).set(adminH)).body.items.map(
          (i: { id: string }) => i.id,
        ),
      ).toContain(id);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: id, action: "customer.watch_changed" },
      });
      expect(audit.after).toMatchObject({ status: "BLACKLIST" });

      const cleared = await http().post(`/customers/${id}/watch`).set(adminH).send({ status: "NONE" });
      expect(cleared.body.watch).toMatchObject({ status: "NONE", reason: null });
    });
  });

  describe("export", () => {
    it("exports the filtered list as CSV with no ID numbers, guards formulas, and audits it", async () => {
      const tag = word();
      const evil = await makeCustomer({ firstName: `=HYPERLINK("http://x")${tag}`, aadhaarNo: aadhaar() });
      await http()
        .patch(`/customers/${evil}/tags`)
        .set(adminH)
        .send({ tags: [tag] });
      const other = await makeCustomer();
      const aad = (await prisma.kycDocument.findFirstOrThrow({ where: { customerId: evil, type: "AADHAAR" } }))
        .numberLast4!;

      const res = await http().get("/customers/export").query({ status: "DRAFT", tag }).set(adminH);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain("attachment");
      const rows = parseCsv(res.text);
      expect(rows[0]).toContain("Code");
      expect(rows).toHaveLength(2); // header + only the tagged customer
      expect(res.text).toContain(`'=HYPERLINK`); // formula neutralised
      expect(res.text).not.toContain(other);
      expect(res.text).not.toMatch(/aadhaar|pan|account/i);
      expect(res.text).not.toContain(aad); // not even the last four digits

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { action: "customer.export", after: { path: ["filters", "tag"], equals: tag } },
      });
      expect(json(log.after)).toContain('"count":1');
    });
  });

  describe("import", () => {
    const upload = (csv: string, dryRun?: boolean) => {
      const req = http().post("/customers/import").set(adminH).attach("file", Buffer.from(csv), "customers.csv");
      return dryRun === undefined ? req : req.field("dryRun", String(dryRun));
    };
    const HEADER =
      "firstName,lastName,gender,dob,phone,email,state,district,pincode,aadhaar,pan,occupationType,monthlyIncome,cibilScore";

    it("serves a template", async () => {
      const res = await http().get("/customers/import/template").set(adminH);
      expect(res.status).toBe(200);
      expect(res.text).toContain("firstName");
    });

    it("dry-run reports every row and writes nothing", async () => {
      const [pOk, pBad] = [phone(), phone()];
      const csv = [
        HEADER,
        `Asha,${word()},FEMALE,15/05/1990,${pOk},asha@x.com,Tamil Nadu,Kanchipuram,631501,${aadhaar()},${pan()},SALARIED,35000,720`,
        `Bad,Row,MALE,1990-13-45,${pBad},,,,12345,123456789012,NOTAPAN,,abc,950`,
      ].join("\n");
      const before = await prisma.customer.count();
      const res = await upload(csv, true);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ dryRun: true, total: 2, ok: 1, errors: 1, created: 0 });
      expect(res.body.rows[0]).toMatchObject({ row: 2, status: "ok" });
      const bad = res.body.rows[1];
      expect(bad.status).toBe("error");
      expect(bad.messages.join(" ")).toMatch(/dob/);
      expect(bad.messages.join(" ")).toMatch(/pincode/);
      expect(bad.messages.join(" ")).toMatch(/aadhaar/);
      expect(bad.messages.join(" ")).toMatch(/pan/);
      expect(bad.messages.join(" ")).toMatch(/monthlyIncome/);
      expect(bad.messages.join(" ")).toMatch(/cibilScore/);
      expect(await prisma.customer.count()).toBe(before);
    });

    it("defaults to a dry run unless dryRun=false is sent", async () => {
      const csv = [HEADER, `Def,${word()},MALE,1990-01-01,${phone()},,,,,,,,,`].join("\n");
      const before = await prisma.customer.count();
      expect((await upload(csv)).body.created).toBe(0);
      expect(await prisma.customer.count()).toBe(before);
    });

    it("imports valid rows as drafts (never active), with encrypted IDs, and flags duplicates", async () => {
      const existingPhone = phone();
      await makeCustomer({ phoneNo: existingPhone });
      const [p1, p2] = [phone(), phone()];
      const a1 = aadhaar();
      const name = `Imp${word()}`;
      const csv = [
        HEADER,
        `${name},One,MALE,1985-03-04,${p1},,Tamil Nadu,Vellore,632001,${a1},${pan()},BUSINESS,50000,690`,
        `${name},Two,FEMALE,20/11/1992,${p2},,Tamil Nadu,Vellore,632002,,,SALARIED,,`,
        `Dup,Phone,MALE,1980-01-01,${existingPhone},,,,,,,,,`,
        `Dup,InFile,MALE,1981-01-01,${p1},,,,,,,,,`,
      ].join("\r\n");

      const res = await upload(csv, false);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ dryRun: false, ok: 2, duplicates: 2, errors: 0, created: 2 });
      expect(res.body.rows[2].messages.join(" ")).toContain("Same mobile number");
      expect(res.body.rows[3].messages.join(" ")).toContain("phone repeated in this file");

      const made = await prisma.customer.findMany({
        where: { firstName: name },
        include: { documents: true },
        orderBy: { lastName: "asc" },
      });
      expect(made.map((c) => c.status)).toEqual(["DRAFT", "DRAFT"]);
      expect(made[0]).toMatchObject({ district: "Vellore", cibilScore: 690, occupationType: "BUSINESS" });
      expect(Number(made[0]!.monthlyIncomePaise)).toBe(50_000_00);
      expect(made[1]!.dob?.toISOString().slice(0, 10)).toBe("1992-11-20"); // DD/MM/YYYY understood
      expect(json(made[0]!.documents)).not.toContain(a1);
      expect(made[0]!.documents.find((d) => d.type === "AADHAAR")!.numberEnc).toMatch(/^v1\./);
      expect(made[0]!.consentAt).toBeNull(); // consent is never faked

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "customer.import" },
        orderBy: { id: "desc" },
      });
      expect(audit.after).toMatchObject({ created: 2, duplicates: 2 });
    });

    it("rejects files with missing columns, no rows, or no file, and ignores unknown columns", async () => {
      expect((await upload("name,mobile\nA,9876543210\n")).body.code).toBe("MISSING_COLUMNS");
      expect((await upload("firstName,phone\n")).body.code).toBe("EMPTY_FILE");
      expect((await http().post("/customers/import").set(adminH)).body.code).toBe("NO_FILE");
      const res = await upload(`firstName,phone,favouriteColour\nZed,${phone()},blue\n`, true);
      expect(res.body.ignoredColumns).toEqual(["favouriteColour"]);
      expect(res.body.ok).toBe(1);
    });

    it("rejects oversize files", async () => {
      const big = `firstName,phone\n${"A,9876543210\n".repeat(200_000)}`;
      expect((await upload(big, true)).status).toBe(413);
    });
  });
});
