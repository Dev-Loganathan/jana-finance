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

    it("plain staff can add notes but cannot export or blacklist", async () => {
      const id = await makeCustomer();
      expect((await http().post(`/customers/${id}/notes`).set(staffH).send({ body: "called" })).status).toBe(201);
      expect((await http().get("/customers/export").set(staffH)).status).toBe(403);
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
});
