import type { INestApplication } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { ACCOUNTS, LedgerService } from "../src/ledger/ledger.service";
import { ensureRoles, makeApp, makeUser, prisma, token, uniq, type TestUser } from "./helpers";

const ANY = "00000000-0000-4000-8000-000000000000";
const key = () => `loan-${randomBytes(6).toString("hex")}`;
const rs = (n: number) => n * 100;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * All amounts below are worked out by hand, so a wrong formula cannot hide behind the code that computes it.
 * Loan: Rs 1,00,000 at 2% a month, disbursed 15 Jan 2025. Cycles: 15 Jan-15 Feb (31 days), 15 Feb-15 Mar (28),
 * 15 Mar-15 Apr (31), 15 Apr-15 May (30). A full cycle costs Rs 2,000 (200,000 paise).
 */
const START = "2025-01-15";
const D = { feb15: "2025-02-15", mar15: "2025-03-15", apr05: "2025-04-05", apr15: "2025-04-15", may15: "2025-05-15" };

const ENDPOINTS: { method: "get" | "post" | "patch" | "delete"; path: string }[] = [
  { method: "get", path: "/loan-products" },
  { method: "post", path: "/loan-products" },
  { method: "patch", path: `/loan-products/${ANY}` },
  { method: "get", path: "/loans" },
  { method: "get", path: "/loans/stats" },
  { method: "get", path: "/loans/interest-due" },
  { method: "get", path: "/loans/preview" },
  { method: "post", path: "/loans" },
  { method: "get", path: `/loans/${ANY}` },
  { method: "patch", path: `/loans/${ANY}` },
  { method: "post", path: `/loans/${ANY}/approve` },
  { method: "post", path: `/loans/${ANY}/reject` },
  { method: "post", path: `/loans/${ANY}/cancel` },
  { method: "post", path: `/loans/${ANY}/disburse` },
  { method: "get", path: `/loans/${ANY}/payoff` },
  { method: "post", path: `/loans/${ANY}/payments` },
  { method: "get", path: `/loans/payments/${ANY}` },
  { method: "post", path: `/loans/payments/${ANY}/reverse` },
  { method: "post", path: `/loans/${ANY}/collateral` },
  { method: "post", path: `/loans/${ANY}/collateral/${ANY}/release` },
  { method: "delete", path: `/loans/${ANY}/collateral/${ANY}` },
  { method: "post", path: `/loans/${ANY}/collateral/${ANY}/photos` },
  { method: "delete", path: `/loans/${ANY}/photos/${ANY}` },
  { method: "get", path: `/loans/files/${ANY}/url` },
];

describe("loans", () => {
  let app: INestApplication;
  let ledger: LedgerService;
  let owner: TestUser;
  let ownerH: { Authorization: string }; // locked Super Admin: everything, including backdating
  let adminA: { Authorization: string; id: string }; // "admin" role: loan create/approve/disburse/reverse, no backdate
  let adminB: { Authorization: string; id: string };
  let staffH: { Authorization: string }; // loan:view + payment:create only
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await makeApp();
    await ensureRoles();
    ledger = app.get(LedgerService);
    owner = await makeUser(app, "super_admin", { totp: true });
    ownerH = await token(app, owner);
    const a = await makeUser(app, "admin");
    const b = await makeUser(app, "admin");
    adminA = { ...(await token(app, a)), id: a.id };
    adminB = { ...(await token(app, b)), id: b.id };
    staffH = await token(app, await makeUser(app, "staff"));
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /* ---------- helpers ---------- */

  async function product(over: Record<string, unknown> = {}) {
    const r = await http()
      .post("/loan-products")
      .set(ownerH)
      .send({
        name: uniq("Prod"),
        monthlyRateBp: 200,
        minRateBp: 100,
        maxRateBp: 300,
        minAmountPaise: rs(1_000),
        maxAmountPaise: rs(10_00_000),
        processingFeeBp: 100, // 1%
        ...over,
      });
    if (r.status !== 201) throw new Error(`product failed ${r.status} ${JSON.stringify(r.body)}`);
    return r.body as { id: string; name: string };
  }

  async function customer(over: Record<string, unknown> = {}) {
    return prisma.customer.create({
      data: {
        code: `T${uniq("c")}`,
        firstName: `Bor${randomBytes(3).toString("hex")}`,
        lastName: "Test",
        status: "ACTIVE",
        kycStatus: "VERIFIED",
        cibilScore: 750,
        monthlyIncomePaise: BigInt(rs(5_00_000)), // comfortably high: no income warnings
        createdById: owner.id,
        phone: `9${randomBytes(4).readUInt32BE().toString().padStart(9, "0").slice(0, 9)}`,
        ...over,
      },
    });
  }

  const apply = (body: object, h: { Authorization: string } = ownerH) => http().post("/loans").set(h).send(body);

  /** Application form -> approve -> disburse. The owner may approve their own application; disbursal is backdated. */
  async function activeLoan(over: { principal?: number; start?: string; product?: string } = {}) {
    const c = await customer();
    const p = over.product ? { id: over.product } : await product();
    const r = await apply({
      customerId: c.id,
      productId: p.id,
      principalPaise: over.principal ?? rs(1_00_000),
      monthlyRateBp: 200,
    });
    if (r.status !== 201) throw new Error(`apply failed ${r.status} ${JSON.stringify(r.body)}`);
    const id = r.body.id as string;
    const ap = await http().post(`/loans/${id}/approve`).set(ownerH).send({});
    if (ap.status !== 200) throw new Error(`approve failed ${JSON.stringify(ap.body)}`);
    const d = await http()
      .post(`/loans/${id}/disburse`)
      .set(ownerH)
      .send({ mode: "CASH", disbursedOn: over.start ?? START });
    if (d.status !== 200) throw new Error(`disburse failed ${JSON.stringify(d.body)}`);
    return { id, code: r.body.code as string, customer: c, body: d.body };
  }

  const pay = (id: string, body: object, h: { Authorization: string } = ownerH, k = key()) =>
    http()
      .post(`/loans/${id}/payments`)
      .set(h)
      .set("Idempotency-Key", k)
      .send({ mode: "CASH", ...body });
  const bal = (code: string, loanId: string) => ledger.balance(code, loanId);
  const view = async (id: string, asOf?: string) => (await http().get(`/loans/${id}`).query({ asOf }).set(ownerH)).body;

  /* ---------- access ---------- */

  describe("access control", () => {
    it("rejects every endpoint without a token", async () => {
      for (const e of ENDPOINTS) {
        const r = await http()[e.method](e.path);
        expect({ ...e, status: r.status }).toEqual({ ...e, status: 401 });
      }
    });

    it("lets staff view and take payments, but not create, approve, disburse, reverse or edit", async () => {
      const loan = await activeLoan();
      expect((await http().get("/loans").set(staffH)).status).toBe(200);
      expect((await http().get(`/loans/${loan.id}`).set(staffH)).status).toBe(200);
      expect((await http().get("/loans/interest-due").set(staffH)).status).toBe(200);
      const denied: [string, string, object][] = [
        ["post", "/loans", {}],
        ["post", `/loans/${loan.id}/approve`, {}],
        ["post", `/loans/${loan.id}/reject`, { reason: "nope" }],
        ["post", `/loans/${loan.id}/disburse`, { mode: "CASH" }],
        ["post", `/loans/${loan.id}/cancel`, {}],
        ["post", `/loans/${loan.id}/collateral`, { kind: "GOLD", description: "Chain" }],
        ["post", "/loan-products", {}],
        ["post", `/loans/payments/${ANY}/reverse`, { reason: "mistake" }],
      ];
      for (const [m, path, body] of denied) {
        const r = await (http() as never as Record<string, (p: string) => request.Test>)[m]!(path)
          .set(staffH)
          .send(body);
        expect({ path, status: r.status }).toEqual({ path, status: 403 });
      }
      // ...but staff can collect. A payment dated today needs no special permission; an earlier date does.
      const back = await pay(loan.id, { interestPaise: rs(2_000), paidOn: D.feb15 }, staffH, key());
      expect(back.status).toBe(403);
      expect(back.body.code).toBe("BACKDATE_FORBIDDEN");
      const today = await pay(loan.id, { interestPaise: rs(2_000) }, staffH, key());
      expect(today.status).toBe(201);
      expect(today.body.receiptNo).toMatch(/^RCP/);
    });
  });

  /* ---------- products ---------- */

  describe("products", () => {
    it("creates, lists and updates a product; existing loans keep their own rate", async () => {
      const p = await product({ monthlyRateBp: 250, minRateBp: 200, maxRateBp: 300 });
      const list = (await http().get("/loan-products").set(staffH)).body as { id: string }[];
      expect(list.map((x) => x.id)).toContain(p.id);
      const loan = await activeLoan({ product: p.id });
      const up = await http()
        .patch(`/loan-products/${p.id}`)
        .set(ownerH)
        .send({
          name: p.name,
          monthlyRateBp: 300,
          minRateBp: 300,
          maxRateBp: 300,
          minAmountPaise: rs(1_000),
          maxAmountPaise: rs(10_00_000),
        });
      expect(up.status).toBe(200);
      expect(up.body.monthlyRateBp).toBe(300);
      expect((await view(loan.id)).monthlyRateBp).toBe(200); // untouched
    });

    it("rejects an inconsistent product and a duplicate name", async () => {
      const bad = await http()
        .post("/loan-products")
        .set(ownerH)
        .send({ name: "X1", monthlyRateBp: 200, minAmountPaise: 500_000, maxAmountPaise: 100_000 });
      expect(bad.status).toBe(400);
      const p = await product();
      const dup = await http()
        .post("/loan-products")
        .set(ownerH)
        .send({ name: p.name, monthlyRateBp: 200, minAmountPaise: 100_000, maxAmountPaise: 900_000 });
      expect(dup.status).toBe(409);
    });

    it("hides inactive products from the list and refuses applications against them", async () => {
      const p = await product();
      await http().patch(`/loan-products/${p.id}`).set(ownerH).send({
        name: p.name,
        monthlyRateBp: 200,
        minRateBp: 100,
        maxRateBp: 300,
        minAmountPaise: 100_000,
        maxAmountPaise: 900_000_00,
        active: false,
      });
      const list = (await http().get("/loan-products").set(ownerH)).body as { id: string }[];
      expect(list.map((x) => x.id)).not.toContain(p.id);
      const all = (await http().get("/loan-products").query({ all: "true" }).set(ownerH)).body as { id: string }[];
      expect(all.map((x) => x.id)).toContain(p.id);
      const c = await customer();
      const r = await apply({ customerId: c.id, productId: p.id, principalPaise: rs(10_000), monthlyRateBp: 200 });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("PRODUCT_INACTIVE");
    });
  });

  /* ---------- application ---------- */

  describe("application", () => {
    it("creates an application with a number, the product's fee, and the monthly interest", async () => {
      const p = await product(); // 1% fee
      const c = await customer();
      const r = await apply({ customerId: c.id, productId: p.id, principalPaise: rs(1_00_000), monthlyRateBp: 200 });
      expect(r.status).toBe(201);
      expect(r.body.code).toMatch(/^LN\d{6}$/);
      expect(r.body.status).toBe("APPLIED");
      expect(r.body.processingFeePaise).toBe(rs(1_000));
      expect(r.body.monthlyInterestPaise).toBe(rs(2_000));
      expect(r.body.yearlyPercent).toBe(24);
      expect(r.body.warnings).toEqual([]);
      expect(r.body.position).toBeNull(); // nothing accrues before disbursal
    });

    it("previews the figures and findings before anything is saved", async () => {
      const p = await product();
      const c = await customer({ kycStatus: "PARTIAL" });
      const r = await http()
        .get("/loans/preview")
        .query({ customerId: c.id, productId: p.id, principalPaise: rs(1_00_000), monthlyRateBp: 200 })
        .set(ownerH);
      expect(r.status).toBe(200);
      expect(r.body.monthlyInterestPaise).toBe(rs(2_000));
      expect(r.body.processingFeePaise).toBe(rs(1_000));
      expect(r.body.warnings.join(" ")).toMatch(/KYC/);
      expect(r.body.blockers).toEqual([]);
    });

    it("keeps the amount and the rate inside what the product allows", async () => {
      const p = await product({ minAmountPaise: rs(10_000), maxAmountPaise: rs(2_00_000) });
      const c = await customer();
      const low = await apply({ customerId: c.id, productId: p.id, principalPaise: rs(5_000), monthlyRateBp: 200 });
      expect(low.body.code).toBe("AMOUNT_OUT_OF_RANGE");
      const high = await apply({ customerId: c.id, productId: p.id, principalPaise: rs(5_00_000), monthlyRateBp: 200 });
      expect(high.body.code).toBe("AMOUNT_OUT_OF_RANGE");
      const rate = await apply({ customerId: c.id, productId: p.id, principalPaise: rs(50_000), monthlyRateBp: 400 });
      expect(rate.body.code).toBe("RATE_OUT_OF_RANGE");
      const fee = await apply({
        customerId: c.id,
        productId: p.id,
        principalPaise: rs(50_000),
        monthlyRateBp: 200,
        processingFeePaise: rs(60_000),
      });
      expect(fee.status).toBe(400);
    });

    it("blocks a draft or blacklisted customer, and records warnings for a weak one", async () => {
      const p = await product();
      const draft = await customer({ status: "DRAFT" });
      const d = await apply({ customerId: draft.id, productId: p.id, principalPaise: rs(10_000), monthlyRateBp: 200 });
      expect(d.status).toBe(422);
      expect(d.body.code).toBe("NOT_ELIGIBLE");
      const black = await customer({ watchStatus: "BLACKLIST" });
      const b = await apply({ customerId: black.id, productId: p.id, principalPaise: rs(10_000), monthlyRateBp: 200 });
      expect(b.status).toBe(422);
      const weak = await customer({ kycStatus: "PARTIAL", cibilScore: 500, monthlyIncomePaise: 0n });
      const w = await apply({ customerId: weak.id, productId: p.id, principalPaise: rs(10_000), monthlyRateBp: 200 });
      expect(w.status).toBe(201);
      expect(w.body.warnings).toHaveLength(3); // KYC, CIBIL, no income
    });

    it("edits an application, recalculating the fee, but only while it is waiting for approval", async () => {
      const p = await product();
      const c = await customer();
      const a = await apply({ customerId: c.id, productId: p.id, principalPaise: rs(1_00_000), monthlyRateBp: 200 });
      const e = await http()
        .patch(`/loans/${a.body.id}`)
        .set(ownerH)
        .send({ principalPaise: rs(2_00_000), purpose: "Shop stock" });
      expect(e.status).toBe(200);
      expect(e.body.principalPaise).toBe(rs(2_00_000));
      expect(e.body.processingFeePaise).toBe(rs(2_000)); // 1% of the new amount
      expect(e.body.purpose).toBe("Shop stock");
      await http().post(`/loans/${a.body.id}/approve`).set(ownerH).send({});
      const late = await http().patch(`/loans/${a.body.id}`).set(ownerH).send({ purpose: "Changed" });
      expect(late.status).toBe(409);
    });

    it("finds loans by number, name and customer, with paging", async () => {
      const loan = await activeLoan();
      const byCode = await http().get("/loans").query({ q: loan.code }).set(ownerH);
      expect(byCode.body.items.map((i: { id: string }) => i.id)).toEqual([loan.id]);
      const byName = await http().get("/loans").query({ q: loan.customer.firstName }).set(ownerH);
      expect(byName.body.total).toBe(1);
      const byCustomer = await http().get("/loans").query({ customerId: loan.customer.id }).set(ownerH);
      expect(byCustomer.body.items[0].customer.id).toBe(loan.customer.id);
      const byStatus = await http().get("/loans").query({ status: "ACTIVE", pageSize: 2 }).set(ownerH);
      expect(byStatus.body.items.length).toBeLessThanOrEqual(2);
      expect(byStatus.body.items.every((i: { status: string }) => i.status === "ACTIVE")).toBe(true);
    });
  });

  /* ---------- approval ---------- */

  describe("approval", () => {
    async function pending(over: Record<string, unknown> = {}, h = adminA) {
      const c = await customer(over);
      const p = await product();
      const r = await apply({ customerId: c.id, productId: p.id, principalPaise: rs(50_000), monthlyRateBp: 200 }, h);
      return { id: r.body.id as string, customer: c };
    }

    it("stops anyone approving their own application, but lets a second person do it", async () => {
      const { id } = await pending();
      const self = await http().post(`/loans/${id}/approve`).set(adminA).send({});
      expect(self.status).toBe(403);
      expect(self.body.code).toBe("SELF_APPROVAL");
      const ok = await http().post(`/loans/${id}/approve`).set(adminB).send({});
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe("APPROVED");
      expect(ok.body.approvedBy).toBeTruthy();
    });

    it("lets the owner (locked Super Admin) approve an application they entered", async () => {
      const c = await customer();
      const p = await product();
      const a = await apply(
        { customerId: c.id, productId: p.id, principalPaise: rs(50_000), monthlyRateBp: 200 },
        ownerH,
      );
      const r = await http().post(`/loans/${a.body.id}/approve`).set(ownerH).send({});
      expect(r.status).toBe(200);
    });

    it("needs a reason to approve past warnings, and keeps that reason", async () => {
      const { id } = await pending({ kycStatus: "PARTIAL" });
      const no = await http().post(`/loans/${id}/approve`).set(adminB).send({});
      expect(no.status).toBe(400);
      expect(no.body.code).toBe("OVERRIDE_REQUIRED");
      expect(no.body.warnings.join(" ")).toMatch(/KYC/);
      const yes = await http()
        .post(`/loans/${id}/approve`)
        .set(adminB)
        .send({ overrideReason: "Known family, KYC due Friday" });
      expect(yes.status).toBe(200);
      expect(yes.body.overrideReason).toBe("Known family, KYC due Friday");
    });

    it("re-checks at approval: a customer blacklisted since the application cannot be approved", async () => {
      const { id, customer: c } = await pending();
      await prisma.customer.update({ where: { id: c.id }, data: { watchStatus: "BLACKLIST" } });
      const r = await http().post(`/loans/${id}/approve`).set(adminB).send({});
      expect(r.status).toBe(422);
    });

    it("rejects with a reason, and a loan can be decided only once", async () => {
      const { id } = await pending();
      expect((await http().post(`/loans/${id}/reject`).set(adminB).send({})).status).toBe(400); // reason required
      const r = await http().post(`/loans/${id}/reject`).set(adminB).send({ reason: "Income proof missing" });
      expect(r.status).toBe(200);
      expect(r.body.status).toBe("REJECTED");
      expect(r.body.rejectionReason).toBe("Income proof missing");
      expect((await http().post(`/loans/${id}/approve`).set(adminB).send({})).status).toBe(409);
      expect((await http().post(`/loans/${id}/reject`).set(adminB).send({ reason: "again" })).status).toBe(409);
      expect((await http().post(`/loans/${id}/cancel`).set(adminB).send({})).status).toBe(409);
    });

    it("cancels an application", async () => {
      const { id } = await pending();
      const r = await http().post(`/loans/${id}/cancel`).set(adminA).send({});
      expect(r.body.status).toBe("CANCELLED");
    });

    it("two people approving at the same moment: exactly one wins", async () => {
      const { id } = await pending();
      const [a, b] = await Promise.all([
        http().post(`/loans/${id}/approve`).set(adminB).send({}),
        http().post(`/loans/${id}/approve`).set(ownerH).send({}),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
    });
  });

  /* ---------- disbursement ---------- */

  describe("disbursement", () => {
    async function approved() {
      const c = await customer();
      const p = await product(); // 1% fee
      const a = await apply({ customerId: c.id, productId: p.id, principalPaise: rs(1_00_000), monthlyRateBp: 200 });
      await http().post(`/loans/${a.body.id}/approve`).set(ownerH).send({});
      return { id: a.body.id as string, customer: c };
    }

    it("posts principal to receivables, the net to cash, and the fee to income, in one balanced entry", async () => {
      const { id } = await approved();
      const r = await http().post(`/loans/${id}/disburse`).set(ownerH).send({ mode: "CASH", disbursedOn: START });
      expect(r.status).toBe(200);
      expect(r.body.status).toBe("ACTIVE");
      expect(r.body.disbursedOn).toBe(START);
      expect(await bal(ACCOUNTS.LOANS_RECEIVABLE, id)).toBe(rs(1_00_000));
      expect(await bal(ACCOUNTS.CASH, id)).toBe(-rs(99_000));
      expect(await bal(ACCOUNTS.FEE_INCOME, id)).toBe(-rs(1_000));
      const je = await prisma.journalEntry.findFirstOrThrow({
        where: { refType: "Loan", refId: id },
        include: { lines: true },
      });
      const dr = je.lines.reduce((s, l) => s + Number(l.debitPaise), 0);
      const cr = je.lines.reduce((s, l) => s + Number(l.creditPaise), 0);
      expect(dr).toBe(cr);
    });

    it("pays out through the bank when asked", async () => {
      const { id } = await approved();
      await http()
        .post(`/loans/${id}/disburse`)
        .set(ownerH)
        .send({ mode: "BANK_TRANSFER", reference: "UTR1", disbursedOn: START });
      expect(await bal(ACCOUNTS.BANK, id)).toBe(-rs(99_000));
      expect(await bal(ACCOUNTS.CASH, id)).toBe(0);
    });

    it("can be done once, and only when approved", async () => {
      const { id } = await approved();
      expect(
        (await http().post(`/loans/${id}/disburse`).set(ownerH).send({ mode: "CASH", disbursedOn: START })).status,
      ).toBe(200);
      expect(
        (await http().post(`/loans/${id}/disburse`).set(ownerH).send({ mode: "CASH", disbursedOn: START })).status,
      ).toBe(409);
      expect(await bal(ACCOUNTS.LOANS_RECEIVABLE, id)).toBe(rs(1_00_000)); // not doubled
      const c = await customer();
      const p = await product();
      const a = await apply({ customerId: c.id, productId: p.id, principalPaise: rs(10_000), monthlyRateBp: 200 });
      expect((await http().post(`/loans/${a.body.id}/disburse`).set(ownerH).send({ mode: "CASH" })).status).toBe(409); // not approved
    });

    it("refuses a future date, and an earlier date without payment:backdate", async () => {
      const { id } = await approved();
      expect(
        (await http().post(`/loans/${id}/disburse`).set(ownerH).send({ mode: "CASH", disbursedOn: "2999-01-01" }))
          .status,
      ).toBe(400);
      const back = await http().post(`/loans/${id}/disburse`).set(adminA).send({ mode: "CASH", disbursedOn: START });
      expect(back.status).toBe(403);
      expect(back.body.code).toBe("BACKDATE_FORBIDDEN");
      expect((await view(id)).status).toBe("APPROVED"); // nothing happened
    });

    it("re-checks the blacklist at disbursal", async () => {
      const { id, customer: c } = await approved();
      await prisma.customer.update({ where: { id: c.id }, data: { watchStatus: "BLACKLIST" } });
      const r = await http().post(`/loans/${id}/disburse`).set(ownerH).send({ mode: "CASH", disbursedOn: START });
      expect(r.status).toBe(422);
      expect(await bal(ACCOUNTS.LOANS_RECEIVABLE, id)).toBe(0);
    });

    it("a payment cannot be taken before the loan is disbursed", async () => {
      const { id } = await approved();
      const r = await pay(id, { interestPaise: rs(100) });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("BAD_STATE");
    });
  });

  /* ---------- the life of a loan ---------- */

  describe("life of a loan: interest every month, part payment, closure", () => {
    let id: string;
    const paymentIds: Record<string, string> = {};

    beforeAll(async () => {
      id = (await activeLoan()).id;
    });

    it("has nothing due on the day it is disbursed", async () => {
      const l = await view(id, START);
      expect(l.position.principalOutstandingPaise).toBe(rs(1_00_000));
      expect(l.position.interestPayablePaise).toBe(0);
      expect(l.position.nextDueDate).toBe(D.feb15);
      expect(l.position.payoffPaise).toBe(rs(1_00_000));
    });

    it("shows two finished months as due on 15 March, one of them overdue", async () => {
      const l = await view(id, D.mar15);
      expect(l.position.interestDuePaise).toBe(rs(4_000));
      expect(l.position.interestOverduePaise).toBe(rs(2_000)); // February's; March's is due today
      expect(l.position.nextDueDate).toBe(D.feb15);
      expect(l.position.oldestOverdueDays).toBe(28);
      expect(l.position.cycles.map((c: { dueDate: string }) => c.dueDate)).toEqual([D.feb15, D.mar15]);
    });

    it("takes the first month's interest and allocates it to that month", async () => {
      const r = await pay(id, { interestPaise: rs(2_000), paidOn: D.feb15, reference: "Cash" });
      expect(r.status).toBe(201);
      paymentIds.first = r.body.id;
      expect(r.body.receiptNo).toMatch(/^RCP\d{6}$/);
      expect(r.body.interestFor).toEqual([{ month: 1, dueDate: D.feb15, amountPaise: rs(2_000) }]);
      expect(r.body.principalPaise).toBe(0);
      expect(r.body.principalOutstandingAfterPaise).toBe(rs(1_00_000));
      expect(r.body.replayed).toBe(false);
      expect(await bal(ACCOUNTS.CASH, id)).toBe(-rs(99_000) + rs(2_000));
      expect(await bal(ACCOUNTS.INTEREST_INCOME, id)).toBe(-rs(2_000));
      expect(await bal(ACCOUNTS.LOANS_RECEIVABLE, id)).toBe(rs(1_00_000)); // interest never touches principal
    });

    it("refuses more interest than is payable, telling the collector the limit", async () => {
      const r = await pay(id, { interestPaise: rs(3_000), paidOn: D.mar15 });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("INTEREST_TOO_HIGH");
      expect(r.body.message).toContain("2,000.00");
    });

    it("takes the second month, and refuses a payment dated before an existing one", async () => {
      const r = await pay(id, { interestPaise: rs(2_000), paidOn: D.mar15 });
      expect(r.status).toBe(201);
      paymentIds.second = r.body.id;
      const early = await pay(id, { interestPaise: rs(100), paidOn: "2025-03-01" });
      expect(early.status).toBe(409);
      expect(early.body.code).toBe("OUT_OF_ORDER");
      const before = await pay(id, { interestPaise: rs(100), paidOn: "2025-01-01" });
      expect(before.body.code).toBe("BEFORE_DISBURSAL");
    });

    it("refuses a future date, and stays silent about nothing to pay", async () => {
      expect((await pay(id, { interestPaise: 100, paidOn: "2999-01-01" })).body.code).toBe("FUTURE_DATE");
      expect((await pay(id, {})).status).toBe(400); // an amount is required
    });

    it("quotes the payoff part-way through a month, counting interest earned so far", async () => {
      // 15 Mar to 5 Apr: 21 days of a 31-day cycle on Rs 1,00,000 at 2% = 135,484 paise
      const q = await http().get(`/loans/${id}/payoff`).query({ asOf: D.apr05 }).set(ownerH);
      expect(q.body.principalPaise).toBe(rs(1_00_000));
      expect(q.body.interestPaise).toBe(135_484);
      expect(q.body.totalPaise).toBe(rs(1_00_000) + 135_484);
    });

    it("refuses more principal than is outstanding, or a cent over the interest", async () => {
      expect((await pay(id, { principalPaise: rs(1_00_001), paidOn: D.apr05 })).body.code).toBe("PRINCIPAL_TOO_HIGH");
      expect((await pay(id, { interestPaise: 135_485, paidOn: D.apr05 })).body.code).toBe("INTEREST_TOO_HIGH");
    });

    it("takes interest and a Rs 40,000 part repayment in one receipt", async () => {
      const r = await pay(id, { interestPaise: 135_484, principalPaise: rs(40_000), paidOn: D.apr05 });
      expect(r.status).toBe(201);
      paymentIds.mixed = r.body.id;
      expect(r.body.amountPaise).toBe(135_484 + rs(40_000));
      expect(r.body.interestFor).toEqual([{ month: 3, dueDate: D.apr15, amountPaise: 135_484 }]);
      expect(r.body.principalOutstandingAfterPaise).toBe(rs(60_000));
      expect(await bal(ACCOUNTS.LOANS_RECEIVABLE, id)).toBe(rs(60_000));
    });

    it("charges the rest of that month on the reduced balance", async () => {
      // Cycle 3: 21 days on 1,00,000 then 10 days on 60,000: 174,194 paise. 135,484 is paid, so 38,710 remains.
      const l = await view(id, D.apr15);
      const c3 = l.position.cycles.find((c: { seq: number }) => c.seq === 3);
      expect(c3).toMatchObject({ accruedPaise: 174_194, paidPaise: 135_484, outstandingPaise: 38_710, complete: true });
      expect(l.position.principalOutstandingPaise).toBe(rs(60_000));
      expect(l.position.interestDuePaise).toBe(38_710);
    });

    it("quotes the exact payoff for 15 May", async () => {
      // 38,710 left on month 3, plus a full month 4 on 60,000 (120,000), plus the 60,000 principal
      const q = await http().get(`/loans/${id}/payoff`).query({ asOf: D.may15 }).set(ownerH);
      expect(q.body).toMatchObject({ principalPaise: rs(60_000), interestPaise: 158_710, totalPaise: 6_158_710 });
    });

    it("does not close on a payment that leaves something owing", async () => {
      const r = await pay(id, { interestPaise: 158_710, principalPaise: rs(60_000) - 1, paidOn: D.may15 });
      expect(r.status).toBe(201);
      paymentIds.almost = r.body.id;
      expect((await view(id, D.may15)).status).toBe("ACTIVE");
      // undo it so the next test can close with the exact payoff
      const rev = await http()
        .post(`/loans/payments/${r.body.id}/reverse`)
        .set(adminA)
        .send({ reason: "Test: try exact" });
      expect(rev.status).toBe(200);
      expect(rev.body.status).toBe("REVERSED");
    });

    it("closes the loan when principal and interest are both cleared, with receivables back to zero", async () => {
      const r = await pay(id, { interestPaise: 158_710, principalPaise: rs(60_000), paidOn: D.may15 });
      expect(r.status).toBe(201);
      paymentIds.closing = r.body.id;
      expect(r.body.principalOutstandingAfterPaise).toBe(0);
      const l = await view(id);
      expect(l.status).toBe("CLOSED");
      expect(l.closedOn).toBe(D.may15);
      expect(await bal(ACCOUNTS.LOANS_RECEIVABLE, id)).toBe(0);
      // 200,000 + 200,000 + 135,484 + 158,710
      expect(await bal(ACCOUNTS.INTEREST_INCOME, id)).toBe(-694_194);
      // everything received in cash: net disbursed out, all of it (principal, interest, no fee refund) back in
      expect(await bal(ACCOUNTS.CASH, id)).toBe(-rs(99_000) + 694_194 + rs(1_00_000));
    });

    it("does not keep accruing once closed, and takes no more payments", async () => {
      const l = await view(id, "2030-01-01");
      expect(l.position.principalOutstandingPaise).toBe(0);
      expect(l.position.interestPayablePaise).toBe(0);
      expect((await pay(id, { interestPaise: 100 })).body.code).toBe("BAD_STATE");
      expect((await http().get(`/loans/${id}/payoff`).set(ownerH)).status).toBe(409);
    });

    it("only the latest receipt can be reversed", async () => {
      const r = await http().post(`/loans/payments/${paymentIds.second}/reverse`).set(adminA).send({ reason: "Wrong" });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("NOT_LATEST");
      expect(r.body.message).toMatch(/RCP\d{6}/);
    });

    it("reversing the closing receipt reopens the loan and restores every balance", async () => {
      const r = await http()
        .post(`/loans/payments/${paymentIds.closing}/reverse`)
        .set(adminA)
        .send({ reason: "Cheque bounced" });
      expect(r.status).toBe(200);
      const l = await view(id, D.may15);
      expect(l.status).toBe("ACTIVE");
      expect(l.closedOn).toBeNull();
      expect(l.position.principalOutstandingPaise).toBe(rs(60_000));
      expect(await bal(ACCOUNTS.LOANS_RECEIVABLE, id)).toBe(rs(60_000));
      expect(await bal(ACCOUNTS.INTEREST_INCOME, id)).toBe(-535_484);
      // reversing again is harmless
      const again = await http()
        .post(`/loans/payments/${paymentIds.closing}/reverse`)
        .set(adminA)
        .send({ reason: "Cheque bounced" });
      expect(again.status).toBe(200);
      expect(await bal(ACCOUNTS.LOANS_RECEIVABLE, id)).toBe(rs(60_000));
    });

    it("needs a reason and the payment:reverse permission", async () => {
      expect((await http().post(`/loans/payments/${paymentIds.mixed}/reverse`).set(adminA).send({})).status).toBe(400);
      expect(
        (await http().post(`/loans/payments/${paymentIds.mixed}/reverse`).set(staffH).send({ reason: "x y z" })).status,
      ).toBe(403);
    });

    it("closes again with the same figures, and the loan's receipts read back correctly", async () => {
      const r = await pay(id, { interestPaise: 158_710, principalPaise: rs(60_000), paidOn: D.may15 });
      expect(r.status).toBe(201);
      const l = await view(id);
      expect(l.status).toBe("CLOSED");
      const posted = l.payments.filter((p: { status: string }) => p.status === "POSTED");
      expect(posted.map((p: { interestPaise: number }) => p.interestPaise)).toEqual([
        158_710, 135_484, 200_000, 200_000,
      ]);
      const receipt = await http().get(`/loans/payments/${paymentIds.first}`).set(staffH);
      expect(receipt.status).toBe(200);
      expect(receipt.body.customer.name).toBeTruthy();
    });
  });

  /* ---------- duplicate and concurrent payments ---------- */

  describe("safety under retries and races", () => {
    it("the same Idempotency-Key returns the same receipt and posts once", async () => {
      const { id } = await activeLoan();
      const k = key();
      const first = await pay(id, { interestPaise: rs(2_000), paidOn: D.feb15 }, ownerH, k);
      const again = await pay(id, { interestPaise: rs(2_000), paidOn: D.feb15 }, ownerH, k);
      expect(first.status).toBe(201);
      expect(again.body.id).toBe(first.body.id);
      expect(again.body.replayed).toBe(true);
      expect(await bal(ACCOUNTS.INTEREST_INCOME, id)).toBe(-rs(2_000));
      const clash = await pay(id, { interestPaise: rs(1_000), paidOn: D.feb15 }, ownerH, k);
      expect(clash.status).toBe(409);
      expect(clash.body.code).toBe("IDEMPOTENCY_MISMATCH");
    });

    it("requires an Idempotency-Key", async () => {
      const { id } = await activeLoan();
      const r = await http()
        .post(`/loans/${id}/payments`)
        .set(ownerH)
        .send({ mode: "CASH", interestPaise: 100, paidOn: D.feb15 });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    });

    it("two identical requests at once take the payment once", async () => {
      const { id } = await activeLoan();
      const k = key();
      const [a, b] = await Promise.all([
        pay(id, { interestPaise: rs(2_000), paidOn: D.feb15 }, ownerH, k),
        pay(id, { interestPaise: rs(2_000), paidOn: D.feb15 }, ownerH, k),
      ]);
      expect([a.status, b.status].every((s) => s === 200 || s === 201)).toBe(true);
      expect(a.body.id).toBe(b.body.id);
      expect(await bal(ACCOUNTS.INTEREST_INCOME, id)).toBe(-rs(2_000));
      expect(await prisma.loanPayment.count({ where: { loanId: id } })).toBe(1);
    });

    it("two different payments at once cannot together take more than is owed", async () => {
      const { id } = await activeLoan();
      // On 15 Mar Rs 4,000 of interest is payable. Two Rs 3,000 payments cannot both fit.
      const [a, b] = await Promise.all([
        pay(id, { interestPaise: rs(3_000), paidOn: D.mar15 }),
        pay(id, { interestPaise: rs(3_000), paidOn: D.mar15 }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 400]);
      expect(await bal(ACCOUNTS.INTEREST_INCOME, id)).toBe(-rs(3_000));
      const l = await view(id, D.mar15);
      expect(l.position.interestDuePaise).toBe(rs(1_000));
    });
  });

  /* ---------- worklist and dashboard figures ---------- */

  describe("interest-due worklist and stats", () => {
    it("sorts the most urgent first and buckets by how late they are", async () => {
      const { id } = await activeLoan(); // 15 Jan start, nothing paid
      const at = async (asOf: string, bucket = "all") =>
        (await http().get("/loans/interest-due").query({ asOf, bucket, pageSize: 200 }).set(staffH)).body;
      const has = (body: { items: { id: string; bucket: string }[] }) => body.items.find((i) => i.id === id);

      expect(has(await at("2025-03-20"))?.bucket).toBe("overdue");
      expect(has(await at("2025-03-20", "overdue"))).toBeTruthy();
      expect(has(await at("2025-03-20", "today"))).toBeUndefined();
      expect(has(await at(D.feb15))?.bucket).toBe("today");
      expect(has(await at("2025-02-10"))?.bucket).toBe("week");
      expect(has(await at("2025-02-10", "week"))).toBeTruthy();
      expect(has(await at("2025-01-20"))?.bucket).toBe("later");
      expect(has(await at("2025-01-20", "week"))).toBeUndefined();

      const overdue = await at("2025-03-20", "overdue");
      const days = overdue.items.map((i: { overdueDays: number }) => i.overdueDays);
      expect([...days].sort((x: number, y: number) => y - x)).toEqual(days); // longest overdue first
      expect(overdue.counts.overdue).toBeGreaterThanOrEqual(1);
    });

    it("finds a loan by customer name or phone in the worklist", async () => {
      const loan = await activeLoan();
      const r = await http()
        .get("/loans/interest-due")
        .query({ q: loan.customer.firstName, asOf: "2025-03-20" })
        .set(staffH);
      expect(r.body.items.map((i: { id: string }) => i.id)).toEqual([loan.id]);
    });

    it("stats count the disbursement in principal outstanding, and interest due", async () => {
      const before = (await http().get("/loans/stats").set(ownerH)).body;
      const loan = await activeLoan();
      const after = (await http().get("/loans/stats").set(ownerH)).body;
      expect(after.active - before.active).toBe(1);
      expect(after.principalOutstandingPaise - before.principalOutstandingPaise).toBe(rs(1_00_000));
      // a loan from Jan 2025 has months of unpaid interest by now
      expect(after.interestOverduePaise - before.interestOverduePaise).toBeGreaterThan(0);
      expect(after.overdueLoans - before.overdueLoans).toBe(1);
      await pay(loan.id, { principalPaise: rs(1_00_000), interestPaise: 0, paidOn: "2025-01-16" });
      const closedOut = (await http().get("/loans/stats").set(ownerH)).body;
      expect(closedOut.principalOutstandingPaise).toBe(before.principalOutstandingPaise);
    });
  });

  /* ---------- collateral ---------- */

  describe("collateral", () => {
    async function withItem(activate = false) {
      const loan = activate
        ? await activeLoan()
        : await (async () => {
            const c = await customer();
            const p = await product();
            const a = await apply({
              customerId: c.id,
              productId: p.id,
              principalPaise: rs(50_000),
              monthlyRateBp: 200,
            });
            return { id: a.body.id as string };
          })();
      const r = await http()
        .post(`/loans/${loan.id}/collateral`)
        .set(ownerH)
        .send({
          kind: "GOLD",
          description: "Gold chain 20g",
          estimatedValuePaise: rs(1_20_000),
          reference: "Receipt 44",
        });
      expect(r.status).toBe(201);
      return { loanId: loan.id, item: r.body.collaterals[0] as { id: string; status: string } };
    }

    it("records security against a loan", async () => {
      const { item } = await withItem();
      expect(item).toMatchObject({
        kind: "GOLD",
        description: "Gold chain 20g",
        estimatedValuePaise: rs(1_20_000),
        status: "HELD",
      });
    });

    it("stores photos, serves them only through a short-lived signed link, and refuses non-images", async () => {
      const { loanId, item } = await withItem();
      const up = await http()
        .post(`/loans/${loanId}/collateral/${item.id}/photos`)
        .set(ownerH)
        .field("label", "front")
        .attach("file", PNG, { filename: "chain.png", contentType: "image/png" });
      expect(up.status).toBe(201);
      const file = up.body.collaterals[0].files[0];
      expect(file).toMatchObject({ label: "front", mimeType: "image/png" });
      expect(JSON.stringify(up.body)).not.toContain("storageKey");

      const url = await http().get(`/loans/files/${file.id}/url`).set(staffH);
      expect(url.status).toBe(200);
      const content = await http().get(url.body.url);
      expect(content.status).toBe(200);
      expect(content.headers["content-type"]).toBe("image/png");
      expect((await http().get(`/files/${file.id}/content`)).status).toBe(403); // no signature

      const bad = await http()
        .post(`/loans/${loanId}/collateral/${item.id}/photos`)
        .set(ownerH)
        .attach("file", Buffer.from("just some text"), { filename: "x.png", contentType: "image/png" });
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe("UNSUPPORTED_FILE");

      const del = await http().delete(`/loans/${loanId}/photos/${file.id}`).set(ownerH);
      expect(del.body.collaterals[0].files).toEqual([]);
    });

    it("does not treat a KYC file as collateral", async () => {
      const c = await customer();
      const f = await prisma.customerFile.create({
        data: {
          customerId: c.id,
          label: "x",
          storageKey: `k/${uniq("f")}`,
          mimeType: "image/png",
          sizeBytes: 1,
          sha256: "0",
          originalName: "a.png",
          uploadedById: owner.id,
        },
      });
      expect((await http().get(`/loans/files/${f.id}/url`).set(ownerH)).status).toBe(404);
    });

    it("keeps the security while money is owed, and hands it back once the loan is closed", async () => {
      const { loanId, item } = await withItem(true);
      const early = await http().post(`/loans/${loanId}/collateral/${item.id}/release`).set(ownerH).send({});
      expect(early.status).toBe(409);
      expect(early.body.code).toBe("LOAN_ACTIVE");
      expect((await http().delete(`/loans/${loanId}/collateral/${item.id}`).set(ownerH)).status).toBe(409); // a record of what was taken

      await pay(loanId, { principalPaise: rs(1_00_000), paidOn: "2025-01-16", interestPaise: 0 }); // ends day 1: 1 day interest remains
      const q = await http().get(`/loans/${loanId}/payoff`).query({ asOf: "2025-01-16" }).set(ownerH);
      expect(q.body.principalPaise).toBe(0);
      // interest for 15 Jan only: 1 day of 31 on 1,00,000 at 2% = 6,451.61 -> 6,452
      expect(q.body.interestPaise).toBe(6_452);
      await pay(loanId, { interestPaise: 6_452, paidOn: "2025-01-16" });
      expect((await view(loanId)).status).toBe("CLOSED");

      const ok = await http()
        .post(`/loans/${loanId}/collateral/${item.id}/release`)
        .set(ownerH)
        .send({ note: "Handed to customer" });
      expect(ok.status).toBe(200);
      expect(ok.body.collaterals[0]).toMatchObject({ status: "RELEASED", releaseNote: "Handed to customer" });
      expect((await http().post(`/loans/${loanId}/collateral/${item.id}/release`).set(ownerH).send({})).status).toBe(
        409,
      );
    });

    it("removes an item from an application that has not been disbursed", async () => {
      const { loanId, item } = await withItem();
      const r = await http().delete(`/loans/${loanId}/collateral/${item.id}`).set(ownerH);
      expect(r.status).toBe(200);
      expect(r.body.collaterals).toEqual([]);
    });
  });

  /* ---------- dashboard ---------- */

  describe("dashboard", () => {
    const dash = async (h: { Authorization: string }) => (await http().get("/dashboard").set(h)).body;

    it("shows the loans section to people who may see loans, and hides it from everyone else", async () => {
      expect((await dash(staffH)).loans).toBeDefined();
      const role = await prisma.role.create({
        data: {
          key: uniq("noloan"),
          name: uniq("No loans"),
          description: "t",
          permissions: ["customer:view"],
          dataScope: "ALL",
        },
      });
      const other = await makeUser(app, "staff");
      await prisma.user.update({ where: { email: other.email }, data: { roleId: role.id } });
      const h = await token(app, other);
      const body = await dash(h);
      expect(body.loans).toBeUndefined();
    });

    it("moves with new loans and payments", async () => {
      const before = (await dash(ownerH)).loans;
      expect(before.months).toHaveLength(6);
      const loan = await activeLoan(); // Jan 2025: many months of unpaid interest
      const after = (await dash(ownerH)).loans;
      expect(after.active - before.active).toBe(1);
      expect(after.principalOutstandingPaise - before.principalOutstandingPaise).toBe(rs(1_00_000));
      expect(after.interestOverduePaise).toBeGreaterThan(before.interestOverduePaise);
      expect(after.overdueLoans - before.overdueLoans).toBe(1);
      expect(after.topOverdue.length).toBeLessThanOrEqual(5);

      // A payment dated today shows in today's and this month's figures
      const paid = await pay(loan.id, { interestPaise: rs(100), principalPaise: rs(500) });
      expect(paid.status).toBe(201);
      const later = (await dash(ownerH)).loans;
      expect(later.today.interestPaise - after.today.interestPaise).toBe(rs(100));
      expect(later.today.principalPaise - after.today.principalPaise).toBe(rs(500));
      expect(later.month.interestPaise - after.month.interestPaise).toBe(rs(100));
      expect(later.principalOutstandingPaise - after.principalOutstandingPaise).toBe(-rs(500));
      const thisMonth = later.months.at(-1);
      expect(thisMonth.paise - after.months.at(-1).paise).toBe(rs(100));

      // Reversing takes it back out
      await http().post(`/loans/payments/${paid.body.id}/reverse`).set(adminA).send({ reason: "Test undo" });
      const undone = (await dash(ownerH)).loans;
      expect(undone.today.interestPaise).toBe(after.today.interestPaise);
      expect(undone.principalOutstandingPaise).toBe(after.principalOutstandingPaise);
    });
  });

  /* ---------- integrity and audit ---------- */

  describe("integrity and audit", () => {
    it("the database itself refuses a payment whose parts do not add up, and a nonsense rate", async () => {
      const loan = await activeLoan();
      await expect(
        prisma.loanPayment.create({
          data: {
            receiptNo: uniq("RCPX"),
            loanId: loan.id,
            amountPaise: 1000n,
            interestPaise: 400n,
            principalPaise: 400n,
            mode: "CASH",
            paidOn: new Date("2025-02-15T00:00:00Z"),
            idempotencyKey: uniq("k"),
            receivedById: owner.id,
          },
        }),
      ).rejects.toThrow();
      await expect(prisma.loan.update({ where: { id: loan.id }, data: { monthlyRateBp: 5000 } })).rejects.toThrow();
    });

    it("writes an audit trail for every step, with no ID or bank numbers", async () => {
      const loan = await activeLoan();
      await pay(loan.id, { interestPaise: rs(2_000), paidOn: D.feb15 });
      const rows = await prisma.auditLog.findMany({ where: { entityId: loan.id } });
      const actions = rows.map((r) => r.action);
      expect(actions).toEqual(expect.arrayContaining(["loan.applied", "loan.approved", "loan.disbursed"]));
      const paid = await prisma.auditLog.count({ where: { action: "loan.payment_received", userId: owner.id } });
      expect(paid).toBeGreaterThan(0);
      expect(JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toMatch(
        /aadhaar|pan|accountNumber/i,
      );
    });

    it("a customer's whole loan history is one query away", async () => {
      const a = await activeLoan();
      const r = await http().get("/loans").query({ customerId: a.customer.id }).set(staffH);
      expect(r.body.total).toBe(1);
      expect(r.body.items[0]).toMatchObject({
        code: a.code,
        status: "ACTIVE",
        principalOutstandingPaise: rs(1_00_000),
      });
    });
  });
});
