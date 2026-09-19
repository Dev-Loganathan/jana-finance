import type { INestApplication } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { calcPenalty, computeAuction } from "@jana/shared";
import { today } from "../src/chits/chit.util";
import { ACCOUNTS, LedgerService } from "../src/ledger/ledger.service";
import { ensureRoles, makeApp, makeUser, prisma, token, uniq, type TestUser } from "./helpers";

const ANY = "00000000-0000-4000-8000-000000000000";
const key = () => `pay-${randomBytes(6).toString("hex")}`;
const rs = (n: number) => n * 100;

const ENDPOINTS: { method: "get" | "post" | "patch" | "delete"; path: string }[] = [
  { method: "get", path: "/chits" },
  { method: "post", path: "/chits" },
  { method: "get", path: `/chits/${ANY}` },
  { method: "patch", path: `/chits/${ANY}` },
  { method: "post", path: `/chits/${ANY}/clone` },
  { method: "post", path: `/chits/${ANY}/open` },
  { method: "post", path: `/chits/${ANY}/start` },
  { method: "post", path: `/chits/${ANY}/cancel` },
  { method: "post", path: `/chits/${ANY}/complete` },
  { method: "get", path: `/chits/${ANY}/statement` },
  { method: "get", path: `/chits/${ANY}/collections` },
  { method: "post", path: `/chits/${ANY}/members` },
  { method: "delete", path: `/chits/${ANY}/members/${ANY}` },
  { method: "post", path: `/chits/${ANY}/members/${ANY}/transfer` },
  { method: "post", path: `/chits/${ANY}/waitlist` },
  { method: "delete", path: `/chits/${ANY}/waitlist/${ANY}` },
  { method: "get", path: `/chits/${ANY}/cycles/1` },
  { method: "post", path: `/chits/${ANY}/cycles/1/bids` },
  { method: "post", path: `/chits/${ANY}/cycles/1/close` },
  { method: "get", path: "/chits/payouts" },
  { method: "post", path: `/chits/payouts/${ANY}/approve` },
  { method: "post", path: `/chits/payouts/${ANY}/pay` },
  { method: "get", path: `/chits/by-customer/${ANY}` },
  { method: "get", path: `/chits/tickets/${ANY}/dues` },
  { method: "get", path: `/chits/tickets/${ANY}/passbook` },
  { method: "post", path: `/chits/tickets/${ANY}/payments` },
  { method: "get", path: `/chits/payments/${ANY}` },
  { method: "post", path: `/chits/payments/${ANY}/reverse` },
];

describe("chit funds", () => {
  let app: INestApplication;
  let ledger: LedgerService;
  let admin: TestUser;
  let adminH: { Authorization: string };
  let staffH: { Authorization: string };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await makeApp();
    await ensureRoles();
    ledger = app.get(LedgerService);
    admin = await makeUser(app, "super_admin", { totp: true });
    adminH = await token(app, admin);
    staffH = await token(app, await makeUser(app, "staff")); // chit:view, payment:view/create only
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /* ---------- helpers ---------- */

  async function customer(
    over: {
      status?: "ACTIVE" | "DRAFT" | "INACTIVE";
      kyc?: "VERIFIED" | "COMPLETE" | "PARTIAL";
      watch?: "NONE" | "BLACKLIST";
    } = {},
  ) {
    return prisma.customer.create({
      data: {
        code: `T${uniq("c")}`,
        firstName: `Mem${randomBytes(3).toString("hex")}`,
        lastName: "Test",
        status: over.status ?? "ACTIVE",
        kycStatus: over.kyc ?? "VERIFIED",
        watchStatus: over.watch ?? "NONE",
        createdById: admin.id,
        phone: `9${randomBytes(4).readUInt32BE().toString().padStart(9, "0").slice(0, 9)}`,
      },
    });
  }

  /** ₹40,000 chit, 4 members, ₹10,000 subscription, 5% commission, bids ₹2,000 to ₹16,000. */
  const base = {
    name: "Test group",
    chitValuePaise: rs(40_000),
    members: 4,
    durationMonths: 4,
    monthlySubscriptionPaise: rs(10_000),
    commissionBp: 500,
    maxBidBp: 4000,
    startDate: "2026-06-01",
    auctionDay: 10,
    dueDaysAfterAuction: 5,
    penaltyRateBp: 200,
    penaltyGraceDays: 3,
  };

  async function group(over: Record<string, unknown> = {}) {
    const r = await http()
      .post("/chits")
      .set(adminH)
      .send({ ...base, ...over });
    if (r.status !== 201) throw new Error(`create failed ${r.status} ${JSON.stringify(r.body)}`);
    return r.body as { id: string; code: string };
  }

  /** Create, open, enrol `members` customers and start. Returns ticket ids by number. */
  async function running(over: Record<string, unknown> = {}) {
    const g = await group(over);
    const members = (over.members as number | undefined) ?? base.members;
    await http().post(`/chits/${g.id}/open`).set(adminH);
    const customers = [];
    for (let i = 0; i < members; i++) {
      const c = await customer();
      customers.push(c);
      const r = await http().post(`/chits/${g.id}/members`).set(adminH).send({ customerId: c.id });
      if (r.status !== 201) throw new Error(`enrol failed ${JSON.stringify(r.body)}`);
    }
    const s = await http().post(`/chits/${g.id}/start`).set(adminH);
    if (s.status !== 200) throw new Error(`start failed ${JSON.stringify(s.body)}`);
    const detail = (await http().get(`/chits/${g.id}`).set(adminH)).body;
    return { ...g, customers, tickets: detail.tickets as { id: string; number: number }[] };
  }

  const bid = (gid: string, month: number, ticketId: string, discountPaise: number) =>
    http().post(`/chits/${gid}/cycles/${month}/bids`).set(adminH).send({ ticketId, discountPaise });
  const close = (gid: string, month: number) => http().post(`/chits/${gid}/cycles/${month}/close`).set(adminH).send({});
  const pay = (ticketId: string, body: object, h = adminH, k = key()) =>
    http()
      .post(`/chits/tickets/${ticketId}/payments`)
      .set(h)
      .set("Idempotency-Key", k)
      .send({ mode: "CASH", ...body });
  const bal = (code: string, gid: string) => ledger.balance(code, gid);
  /** Penalty accrued today on a Rs 8,500 installment that fell due on 2026-06-15 (2% a month, 3 days grace). */
  const month1Penalty = () =>
    calcPenalty({
      outstandingPaise: rs(8_500),
      dueDate: "2026-06-15",
      asOf: today(),
      graceDays: 3,
      rateBpPerMonth: 200,
    });

  /* ---------- permissions ---------- */

  describe("permissions", () => {
    describe.each(ENDPOINTS)("$method $path", ({ method, path }) => {
      it("401 without a token", async () => expect((await http()[method](path)).status).toBe(401));
      it("403 without the permission", async () => {
        const role = await prisma.role.create({
          data: { name: `np-${randomBytes(3).toString("hex")}`, permissions: ["audit:view"] },
        });
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

    it("plain staff can view and collect, but cannot create, run auctions, approve payouts or reverse", async () => {
      const g = await running();
      expect((await http().get("/chits").set(staffH)).status).toBe(200);
      expect((await http().post("/chits").set(staffH).send(base)).status).toBe(403);
      expect((await http().post(`/chits/${g.id}/cycles/1/close`).set(staffH).send({})).status).toBe(403);
      expect((await http().post(`/chits/${g.id}/members`).set(staffH).send({ customerId: ANY })).status).toBe(403);
      expect((await http().post(`/chits/payments/${ANY}/reverse`).set(staffH).send({ reason: "x" })).status).toBe(403);
      expect(
        (await http().post(`/chits/payouts/${ANY}/approve`).set(staffH).send({ securityVerified: true })).status,
      ).toBe(403);
    });
  });

  /* ---------- groups ---------- */

  describe("groups", () => {
    it("creates a coded group with vacant tickets, and enforces the configuration rules", async () => {
      const g = await http().post("/chits").set(adminH).send(base);
      expect(g.status).toBe(201);
      expect(g.body).toMatchObject({
        status: "DRAFT",
        members: 4,
        minBidBp: 500,
        filled: 0,
        vacant: 4,
        code: expect.stringMatching(/^CHIT\d{3,}$/),
      });
      expect(await prisma.chitTicket.count({ where: { groupId: g.body.id } })).toBe(4);

      const bad = (over: object) =>
        http()
          .post("/chits")
          .set(adminH)
          .send({ ...base, ...over });
      expect((await bad({ monthlySubscriptionPaise: rs(9_000) })).status).toBe(400); // members x subscription != value
      expect((await bad({ durationMonths: 6 })).status).toBe(400);
      expect((await bad({ minBidBp: 100 })).status).toBe(400); // below commission
      expect((await bad({ commissionBp: 2000, minBidBp: 2000 })).status).toBe(400);
      expect((await bad({ startDate: "01-06-2026" })).status).toBe(400);
      expect((await bad({ auctionDay: 32 })).status).toBe(400);
    });

    it("allows full edits only while draft, then just name, notes and penalty", async () => {
      const g = await group();
      const edit = await http()
        .patch(`/chits/${g.id}`)
        .set(adminH)
        .send({ members: 5, durationMonths: 5, monthlySubscriptionPaise: rs(8_000) });
      expect(edit.status).toBe(200);
      expect(await prisma.chitTicket.count({ where: { groupId: g.id } })).toBe(5);
      expect((await http().patch(`/chits/${g.id}`).set(adminH).send({ members: 4 })).status).toBe(400); // now inconsistent with value

      await http().post(`/chits/${g.id}/open`).set(adminH);
      const locked = await http().patch(`/chits/${g.id}`).set(adminH).send({ commissionBp: 300 });
      expect(locked.body.code).toBe("LOCKED");
      expect(
        (await http().patch(`/chits/${g.id}`).set(adminH).send({ name: "Renamed", penaltyRateBp: 300 })).body,
      ).toMatchObject({ name: "Renamed", penaltyRateBp: 300 });
    });

    it("clones a group as a new draft and cancels one that has not started", async () => {
      const g = await group();
      const c = await http().post(`/chits/${g.id}/clone`).set(adminH);
      expect(c.status).toBe(201);
      expect(c.body).toMatchObject({
        name: "Test group (copy)",
        status: "DRAFT",
        chitValuePaise: rs(40_000),
        members: 4,
      });
      expect(c.body.id).not.toBe(g.id);
      expect(
        (await http().post(`/chits/${c.body.id}/cancel`).set(adminH).send({ reason: "not needed" })).body.status,
      ).toBe("CANCELLED");
      expect((await http().post(`/chits/${c.body.id}/open`).set(adminH)).body.code).toBe("BAD_STATE");
    });
  });

  /* ---------- membership ---------- */

  describe("membership", () => {
    it("only lets eligible customers join: active, KYC complete, not blacklisted", async () => {
      const g = await group();
      const enrol = (customerId: string) => http().post(`/chits/${g.id}/members`).set(adminH).send({ customerId });
      const ok = await customer();
      expect((await enrol(ok.id)).body.code).toBe("BAD_STATE"); // not open yet
      await http().post(`/chits/${g.id}/open`).set(adminH);

      expect((await enrol((await customer({ status: "DRAFT" })).id)).body.code).toBe("CUSTOMER_NOT_ACTIVE");
      expect((await enrol((await customer({ status: "INACTIVE" })).id)).body.code).toBe("CUSTOMER_NOT_ACTIVE");
      expect((await enrol((await customer({ watch: "BLACKLIST" })).id)).body.code).toBe("CUSTOMER_BLACKLISTED");
      expect((await enrol((await customer({ kyc: "PARTIAL" })).id)).body.code).toBe("KYC_INCOMPLETE");
      expect((await enrol(ANY)).body.code).toBe("CUSTOMER_NOT_FOUND");
      expect((await enrol((await customer({ kyc: "COMPLETE" })).id)).status).toBe(201); // complete (not yet verified) is enough
    });

    it("assigns seats, supports several tickets per customer, and reports when full", async () => {
      const g = await group();
      await http().post(`/chits/${g.id}/open`).set(adminH);
      const c = await customer();
      const a = await http().post(`/chits/${g.id}/members`).set(adminH).send({ customerId: c.id });
      const b = await http().post(`/chits/${g.id}/members`).set(adminH).send({ customerId: c.id, ticketNumber: 3 });
      expect([a.body.number, b.body.number]).toEqual([1, 3]);
      expect(
        (
          await http()
            .post(`/chits/${g.id}/members`)
            .set(adminH)
            .send({ customerId: (await customer()).id, ticketNumber: 3 })
        ).body.code,
      ).toBe("SEAT_TAKEN");
      expect((await http().get(`/chits/by-customer/${c.id}`).set(staffH)).body).toHaveLength(2);

      await http()
        .post(`/chits/${g.id}/members`)
        .set(adminH)
        .send({ customerId: (await customer()).id });
      await http()
        .post(`/chits/${g.id}/members`)
        .set(adminH)
        .send({ customerId: (await customer()).id });
      const late = await customer();
      expect((await http().post(`/chits/${g.id}/members`).set(adminH).send({ customerId: late.id })).body.code).toBe(
        "GROUP_FULL",
      );

      // waiting list, then a seat frees up
      expect((await http().post(`/chits/${g.id}/waitlist`).set(adminH).send({ customerId: late.id })).status).toBe(201);
      expect((await http().post(`/chits/${g.id}/waitlist`).set(adminH).send({ customerId: c.id })).body.code).toBe(
        "ALREADY_MEMBER",
      );
      const detail = (await http().get(`/chits/${g.id}`).set(adminH)).body;
      expect(detail.waitlist).toHaveLength(1);
      expect((await http().delete(`/chits/${g.id}/members/${detail.tickets[3].id}`).set(adminH)).status).toBe(204);
      expect((await http().post(`/chits/${g.id}/members`).set(adminH).send({ customerId: late.id })).status).toBe(201);
      expect((await http().get(`/chits/${g.id}`).set(adminH)).body.waitlist).toHaveLength(0); // removed on enrolment
    });

    it("cannot start with vacant seats; once started, members are locked but tickets can transfer (audited)", async () => {
      const g = await group();
      await http().post(`/chits/${g.id}/open`).set(adminH);
      await http()
        .post(`/chits/${g.id}/members`)
        .set(adminH)
        .send({ customerId: (await customer()).id });
      const early = await http().post(`/chits/${g.id}/start`).set(adminH);
      expect(early.body.code).toBe("SEATS_VACANT");

      const r = await running();
      const t = r.tickets[0]!;
      expect((await http().delete(`/chits/${r.id}/members/${t.id}`).set(adminH)).body.code).toBe("BAD_STATE");
      expect(
        (
          await http()
            .post(`/chits/${r.id}/members`)
            .set(adminH)
            .send({ customerId: (await customer()).id })
        ).body.code,
      ).toBe("BAD_STATE");

      const to = await customer();
      const tr = await http()
        .post(`/chits/${r.id}/members/${t.id}/transfer`)
        .set(adminH)
        .send({ toCustomerId: to.id, reason: "Member moved abroad" });
      expect(tr.status).toBe(200);
      expect((await prisma.chitTicket.findUniqueOrThrow({ where: { id: t.id } })).customerId).toBe(to.id);
      expect(await prisma.chitTransfer.count({ where: { ticketId: t.id } })).toBe(1);
      expect(
        (
          await http()
            .post(`/chits/${r.id}/members/${t.id}/transfer`)
            .set(adminH)
            .send({ toCustomerId: to.id, reason: "again" })
        ).body.code,
      ).toBe("SAME_CUSTOMER");
      expect(
        (
          await http()
            .post(`/chits/${r.id}/members/${t.id}/transfer`)
            .set(adminH)
            .send({ toCustomerId: (await customer({ watch: "BLACKLIST" })).id, reason: "x y z" })
        ).body.code,
      ).toBe("CUSTOMER_BLACKLISTED");
    });

    it("generates the schedule and every installment when the group starts", async () => {
      const r = await running();
      const g = (await http().get(`/chits/${r.id}`).set(adminH)).body;
      expect(g.status).toBe("RUNNING");
      expect(g.cycles.map((c: { auctionDate: string }) => c.auctionDate)).toEqual([
        "2026-06-10",
        "2026-07-10",
        "2026-08-10",
        "2026-09-10",
      ]);
      expect(g.cycles[0].dueDate).toBe("2026-06-15");
      expect(await prisma.chitInstallment.count({ where: { cycle: { groupId: r.id } } })).toBe(16);
      expect(await prisma.chitInstallment.count({ where: { cycle: { groupId: r.id }, netDuePaise: null } })).toBe(16); // not payable until the auction
    });
  });

  /* ---------- auction ---------- */

  describe("auction", () => {
    it("records bids in order, enforces limits and eligibility, and awards the highest discount (earliest wins a tie)", async () => {
      const r = await running();
      const t1 = r.tickets[0]!,
        t2 = r.tickets[1]!,
        t3 = r.tickets[2]!;

      expect((await bid(r.id, 2, t1.id, rs(8_000))).body.code).toBe("OUT_OF_ORDER");
      expect((await bid(r.id, 1, t1.id, rs(1_999))).body.code).toBe("BID_OUT_OF_RANGE"); // below the 5% commission
      expect((await bid(r.id, 1, t1.id, rs(16_001))).body.code).toBe("BID_OUT_OF_RANGE"); // above the 40% cap
      expect((await bid(r.id, 1, ANY, rs(8_000))).body.code).toBe("NOT_ELIGIBLE");
      expect((await close(r.id, 1)).body.code).toBe("NO_BIDS");

      const b1 = await bid(r.id, 1, t1.id, rs(6_000));
      const b2 = await bid(r.id, 1, t2.id, rs(8_000));
      const b3 = await bid(r.id, 1, t3.id, rs(8_000)); // ties with t2, but recorded later
      expect([b1.body.seq, b2.body.seq, b3.body.seq]).toEqual([1, 2, 3]);

      const detail = (await http().get(`/chits/${r.id}/cycles/1`).set(staffH)).body;
      expect(detail.limits).toMatchObject({
        minDiscountPaise: rs(2_000),
        maxDiscountPaise: rs(16_000),
        commissionPaise: rs(2_000),
      });
      expect(detail.bids).toHaveLength(3);
      expect(detail.eligible).toHaveLength(4);

      const res = await close(r.id, 1);
      expect(res.status).toBe(200);
      // Rs 40,000 chit, discount Rs 8,000, commission Rs 2,000 -> pool 6,000 / 4 = 1,500 each, prize 32,000, installment 8,500
      expect(res.body.breakdown).toEqual(
        computeAuction({ chitValuePaise: rs(40_000), members: 4, commissionBp: 500, discountPaise: rs(8_000) }),
      );
      expect(res.body).toMatchObject({
        status: "CLOSED",
        winnerTicketNumber: 2,
        discountPaise: rs(8_000),
        prizePaise: rs(32_000),
        dividendPerMemberPaise: rs(1_500),
        netInstallmentPaise: rs(8_500),
        method: "AUCTION",
      });
      expect(res.body.note).toContain("earliest recorded bid won");

      // effects: winner is prized, every installment is now payable at the net amount, payout is pending
      expect((await prisma.chitTicket.findUniqueOrThrow({ where: { id: t2.id } })).prized).toBe(true);
      const inst = await prisma.chitInstallment.findMany({ where: { cycle: { groupId: r.id, month: 1 } } });
      expect(inst.every((i) => Number(i.netDuePaise) === rs(8_500) && Number(i.dividendPaise) === rs(1_500))).toBe(
        true,
      );
      const payout = await prisma.chitPayout.findFirstOrThrow({ where: { groupId: r.id } });
      expect(payout).toMatchObject({ status: "PENDING", ticketId: t2.id });
      expect(Number(payout.prizePaise)).toBe(rs(32_000));

      // foreman income is in the ledger, and closing twice does nothing more
      expect(await bal(ACCOUNTS.CHIT_COMMISSION_INCOME, r.id)).toBe(-rs(2_000));
      expect(await bal(ACCOUNTS.CHIT_PAYABLE, r.id)).toBe(rs(2_000));
      expect((await close(r.id, 1)).body.code).toBe("ALREADY_CLOSED");
      expect((await bid(r.id, 1, t1.id, rs(9_000))).body.code).toBe("ALREADY_CLOSED");
      expect(await prisma.chitPayout.count({ where: { groupId: r.id } })).toBe(1);
    });

    it("a ticket that has won cannot bid again, and the bid record cannot be edited or deleted", async () => {
      const r = await running();
      const t1 = r.tickets[0]!,
        t2 = r.tickets[1]!;
      await bid(r.id, 1, t1.id, rs(5_000));
      await close(r.id, 1);
      expect((await bid(r.id, 2, t1.id, rs(9_000))).body.code).toBe("NOT_ELIGIBLE");
      const rec = await prisma.chitBid.findFirstOrThrow({ where: { cycle: { groupId: r.id } } });
      await expect(
        prisma.$executeRaw`UPDATE "ChitBid" SET "discountPaise" = 1 WHERE id = ${rec.id}::uuid`,
      ).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRaw`DELETE FROM "ChitBid" WHERE id = ${rec.id}::uuid`).rejects.toThrow(/append-only/);
      expect(t2.id).toBeTruthy();
    });

    it("members in arrears cannot bid until they clear their dues", async () => {
      const r = await running();
      const t1 = r.tickets[0]!,
        t2 = r.tickets[1]!,
        t3 = r.tickets[2]!;
      await bid(r.id, 1, t1.id, rs(5_000));
      await close(r.id, 1); // month 1 installments (due 2026-06-15) are unpaid and overdue by the month-2 auction
      const blocked = await bid(r.id, 2, t2.id, rs(9_000));
      expect(blocked.body.code).toBe("IN_ARREARS");
      expect(
        (await http().get(`/chits/${r.id}/cycles/2`).set(adminH)).body.eligible.every(
          (e: { inArrears: boolean }) => e.inArrears,
        ),
      ).toBe(true);

      // t2 pays month 1 in full (net = 10,000 - dividend)
      const net = Number(
        (await prisma.chitInstallment.findFirstOrThrow({ where: { ticketId: t2.id, netDuePaise: { not: null } } }))
          .netDuePaise,
      );
      const dues = (await http().get(`/chits/tickets/${t2.id}/dues`).set(adminH)).body;
      await pay(t2.id, { amountPaise: dues.totalPayablePaise });
      expect(dues.outstandingPaise).toBe(net);
      expect((await bid(r.id, 2, t2.id, rs(9_000))).status).toBe(201);
      expect((await bid(r.id, 2, t3.id, rs(9_000))).body.code).toBe("IN_ARREARS");
    });

    it("lottery and fixed chits need no bids: fixed follows the payout order, lottery never repeats a winner", async () => {
      const f = await running({ type: "FIXED", minBidBp: undefined });
      const t = f.tickets as { id: string; number: number }[];
      const m1 = await close(f.id, 1);
      const m2 = await close(f.id, 2);
      expect([m1.body.winnerTicketNumber, m2.body.winnerTicketNumber]).toEqual([1, 2]);
      // value minus commission, no dividend
      expect(m1.body).toMatchObject({
        prizePaise: rs(38_000),
        dividendPerMemberPaise: 0,
        netInstallmentPaise: rs(10_000),
        method: "FIXED",
      });
      expect((await bid(f.id, 3, t[2]!.id, rs(5_000))).body.code).toBe("NOT_AN_AUCTION");

      const l = await running({ type: "LOTTERY" });
      const winners = new Set<number>();
      for (const m of [1, 2, 3, 4]) {
        // Everyone must be in good standing for the draw: pay each month before the next draw.
        const res = await close(l.id, m);
        expect(res.status).toBe(200);
        winners.add(res.body.winnerTicketNumber);
        for (const tk of l.tickets) {
          const d = (await http().get(`/chits/tickets/${tk.id}/dues`).set(adminH)).body;
          if (d.totalPayablePaise > 0) await pay(tk.id, { amountPaise: d.totalPayablePaise });
        }
      }
      expect(winners.size).toBe(4); // every ticket won exactly once
      expect((await close(l.id, 4)).body.code).toBe("ALREADY_CLOSED");
    });
  });

  /* ---------- collections ---------- */

  describe("collections", () => {
    async function afterMonth1() {
      const r = await running();
      const t1 = r.tickets[0]!,
        t2 = r.tickets[1]!;
      await bid(r.id, 1, t1.id, rs(8_000));
      await close(r.id, 1); // net installment 8,500, due 2026-06-15 (long overdue)
      return { ...r, t1, t2 };
    }

    it("requires an Idempotency-Key, and rejects future dates and non-positive amounts", async () => {
      const r = await afterMonth1();
      expect(
        (await http().post(`/chits/tickets/${r.t2.id}/payments`).set(adminH).send({ amountPaise: 100, mode: "CASH" }))
          .body.code,
      ).toBe("IDEMPOTENCY_KEY_REQUIRED");
      expect((await pay(r.t2.id, { amountPaise: 100, paidOn: "2999-01-01" })).body.code).toBe("FUTURE_DATE");
      expect((await pay(r.t2.id, { amountPaise: 0 })).status).toBe(400);
      expect((await pay(r.t2.id, { amountPaise: 100, mode: "SET_OFF" })).status).toBe(400);
    });

    it("shows dues with the penalty accrued to date, and allocates penalty first, then dues", async () => {
      const r = await afterMonth1();
      const d = (await http().get(`/chits/tickets/${r.t2.id}/dues`).set(staffH)).body;
      const expectedPenalty = calcPenalty({
        outstandingPaise: rs(8_500),
        dueDate: "2026-06-15",
        asOf: today(),
        graceDays: 3,
        rateBpPerMonth: 200,
      });
      expect(expectedPenalty).toBeGreaterThan(0);
      expect(d).toMatchObject({
        outstandingPaise: rs(8_500),
        penaltyPaise: expectedPenalty,
        totalPayablePaise: rs(8_500) + expectedPenalty,
        advancePaise: 0,
      });
      expect(d.installments).toHaveLength(1);

      const cashBefore = await bal(ACCOUNTS.CASH, r.id);
      const p = await pay(r.t2.id, { amountPaise: expectedPenalty + rs(5_000), reference: "R-1" }, staffH);
      expect(p.status).toBe(201);
      expect(p.body).toMatchObject({
        status: "POSTED",
        amountPaise: expectedPenalty + rs(5_000),
        mode: "CASH",
        replayed: false,
        receiptNo: expect.stringMatching(/^RCP\d{6}$/),
      });
      expect(p.body.allocations).toEqual(
        expect.arrayContaining([
          { kind: "PENALTY", month: 1, amountPaise: expectedPenalty },
          { kind: "INSTALLMENT", month: 1, amountPaise: rs(5_000) },
        ]),
      );

      const after = (await http().get(`/chits/tickets/${r.t2.id}/dues`).set(adminH)).body;
      expect(after.outstandingPaise).toBe(rs(3_500));
      // Penalty was fully paid; only new accrual on the smaller balance can remain, never a repeat of what was paid
      expect(after.penaltyPaise).toBeLessThanOrEqual(
        calcPenalty({
          outstandingPaise: rs(3_500),
          dueDate: "2026-06-15",
          asOf: today(),
          graceDays: 3,
          rateBpPerMonth: 200,
        }),
      );

      // Ledger: cash in, member pool credited, penalty recognised as income
      expect((await bal(ACCOUNTS.CASH, r.id)) - cashBefore).toBe(expectedPenalty + rs(5_000));
      expect(await bal(ACCOUNTS.PENALTY_INCOME, r.id)).toBe(-expectedPenalty);
    });

    it("is idempotent: a retry with the same key returns the same receipt and posts nothing twice", async () => {
      const r = await afterMonth1();
      const k = key();
      const first = await pay(r.t2.id, { amountPaise: rs(1_000) }, adminH, k);
      const cash = await bal(ACCOUNTS.CASH, r.id);
      const [again, parallel] = await Promise.all([
        pay(r.t2.id, { amountPaise: rs(1_000) }, adminH, k),
        pay(r.t2.id, { amountPaise: rs(1_000) }, adminH, k),
      ]);
      expect(again.body).toMatchObject({ id: first.body.id, receiptNo: first.body.receiptNo, replayed: true });
      expect(parallel.body.id).toBe(first.body.id);
      expect(await bal(ACCOUNTS.CASH, r.id)).toBe(cash);
      expect(await prisma.chitPayment.count({ where: { ticketId: r.t2.id } })).toBe(1);
      expect(
        (await prisma.chitInstallment.findFirstOrThrow({ where: { ticketId: r.t2.id, netDuePaise: { not: null } } }))
          .paidPaise,
        // penalty is settled first, so only the rest reduces the installment
      ).toBe(BigInt(rs(1_000) - month1Penalty()));
      // The same key for a different payment is an error, not a silent second payment
      expect((await pay(r.t2.id, { amountPaise: rs(2_000) }, adminH, k)).body.code).toBe("IDEMPOTENCY_MISMATCH");
    });

    it("back-dating needs its own permission", async () => {
      const r = await afterMonth1();
      expect((await pay(r.t2.id, { amountPaise: 100, paidOn: "2026-09-01" }, staffH)).body.code).toBe(
        "BACKDATE_FORBIDDEN",
      );
      const ok = await pay(r.t2.id, { amountPaise: 100, paidOn: "2026-09-01" }, adminH);
      expect(ok.status).toBe(201);
      expect(ok.body.paidOn).toBe("2026-09-01");
    });

    it("bank and UPI payments go to the bank account; overpayment is kept as advance and applied at the next auction", async () => {
      const r = await afterMonth1();
      const bankBefore = await bal(ACCOUNTS.BANK, r.id);
      const d = (await http().get(`/chits/tickets/${r.t2.id}/dues`).set(adminH)).body;
      const p = await pay(r.t2.id, { amountPaise: d.totalPayablePaise + rs(4_000), mode: "UPI", reference: "UPI123" });
      expect(p.body.allocations).toEqual(
        expect.arrayContaining([{ kind: "ADVANCE", month: null, amountPaise: rs(4_000) }]),
      );
      expect((await bal(ACCOUNTS.BANK, r.id)) - bankBefore).toBe(d.totalPayablePaise + rs(4_000));
      expect((await http().get(`/chits/tickets/${r.t2.id}/dues`).set(adminH)).body.advancePaise).toBe(rs(4_000));

      // Month 2: pay month-1 dues for the others so someone can bid, then the advance is applied automatically
      for (const t of r.tickets.filter((x) => x.id !== r.t2.id)) {
        const dd = (await http().get(`/chits/tickets/${t.id}/dues`).set(adminH)).body;
        if (dd.totalPayablePaise) await pay(t.id, { amountPaise: dd.totalPayablePaise });
      }
      await bid(r.id, 2, r.tickets[1]!.id, rs(9_000));
      const m2 = await close(r.id, 2);
      const inst = await prisma.chitInstallment.findFirstOrThrow({ where: { ticketId: r.t2.id, cycle: { month: 2 } } });
      expect(Number(inst.paidPaise)).toBe(rs(4_000));
      expect(Number(inst.netDuePaise)).toBe(m2.body.netInstallmentPaise);
      expect(Number((await prisma.chitTicket.findUniqueOrThrow({ where: { id: r.t2.id } })).advancePaise)).toBe(0);
      expect(await prisma.chitPaymentAllocation.count({ where: { ticketId: r.t2.id, kind: "ADVANCE_APPLIED" } })).toBe(
        1,
      );
    });

    it("reverses a payment: allocations unwind, the ledger is mirrored, and it is safe to repeat", async () => {
      const r = await afterMonth1();
      const cash0 = await bal(ACCOUNTS.CASH, r.id);
      const payable0 = await bal(ACCOUNTS.CHIT_PAYABLE, r.id);
      const p = await pay(r.t2.id, { amountPaise: rs(3_000) });
      expect(await bal(ACCOUNTS.CASH, r.id)).toBe(cash0 + rs(3_000));

      expect(
        (await http().post(`/chits/payments/${p.body.id}/reverse`).set(staffH).send({ reason: "typo" })).status,
      ).toBe(403);
      const rev = await http()
        .post(`/chits/payments/${p.body.id}/reverse`)
        .set(adminH)
        .send({ reason: "Entered against the wrong member" });
      expect(rev.status).toBe(200);
      expect(rev.body).toMatchObject({ status: "REVERSED", reversalReason: "Entered against the wrong member" });
      expect(
        (await http().post(`/chits/payments/${p.body.id}/reverse`).set(adminH).send({ reason: "again" })).body.status,
      ).toBe("REVERSED");

      expect(await bal(ACCOUNTS.CASH, r.id)).toBe(cash0);
      expect(await bal(ACCOUNTS.CHIT_PAYABLE, r.id)).toBe(payable0);
      const inst = await prisma.chitInstallment.findFirstOrThrow({
        where: { ticketId: r.t2.id, netDuePaise: { not: null } },
      });
      expect(Number(inst.paidPaise)).toBe(0);
      expect(await prisma.journalEntry.count({ where: { refType: "ChitPayment", refId: p.body.id } })).toBe(2); // original + reversal, nothing edited
      expect(await prisma.auditLog.count({ where: { entityId: p.body.id, action: "chit.payment_reversed" } })).toBe(1);
    });

    it("will not reverse a payment whose advance has already been used", async () => {
      const r = await afterMonth1();
      const d = (await http().get(`/chits/tickets/${r.t2.id}/dues`).set(adminH)).body;
      const p = await pay(r.t2.id, { amountPaise: d.totalPayablePaise + rs(2_000) });
      for (const t of r.tickets.filter((x) => x.id !== r.t2.id)) {
        const dd = (await http().get(`/chits/tickets/${t.id}/dues`).set(adminH)).body;
        if (dd.totalPayablePaise) await pay(t.id, { amountPaise: dd.totalPayablePaise });
      }
      await bid(r.id, 2, r.tickets[1]!.id, rs(9_000));
      await close(r.id, 2); // consumes the advance
      expect(
        (await http().post(`/chits/payments/${p.body.id}/reverse`).set(adminH).send({ reason: "oops" })).body.code,
      ).toBe("ADVANCE_CONSUMED");
    });

    it("lists the collector's worklist with totals", async () => {
      const r = await afterMonth1();
      const w = (await http().get(`/chits/${r.id}/collections`).set(staffH)).body;
      expect(w.rows).toHaveLength(4);
      expect(w.totals.outstandingPaise).toBe(4 * rs(8_500));
      expect(w.totals.overduePaise).toBe(4 * rs(8_500));
      expect(w.rows[0]).toMatchObject({ number: 1, outstandingPaise: rs(8_500), oldestDueDate: "2026-06-15" });
    });
  });

  /* ---------- payouts, passbook, completion ---------- */

  describe("payouts and completion", () => {
    it("approval needs the security check; it sets off the winner's own dues; paying posts to the ledger once", async () => {
      const r = await running();
      const t1 = r.tickets[0]!,
        t2 = r.tickets[1]!;
      await bid(r.id, 1, t1.id, rs(8_000));
      await close(r.id, 1);
      const payout = (await http().get("/chits/payouts").query({ groupId: r.id }).set(staffH)).body[0];
      expect(payout).toMatchObject({ status: "PENDING", prizePaise: rs(32_000), ticketNumber: 1 });

      expect((await http().post(`/chits/payouts/${payout.id}/pay`).set(adminH).send({ mode: "CASH" })).body.code).toBe(
        "BAD_STATE",
      ); // not approved yet
      expect(
        (await http().post(`/chits/payouts/${payout.id}/approve`).set(adminH).send({ securityVerified: false })).body
          .code,
      ).toBe("SECURITY_NOT_VERIFIED");

      // the winner owes 8,500 for the month; other members pay so the pool holds the cash
      for (const t of [t2, r.tickets[2]!, r.tickets[3]!])
        await pay(t.id, {
          amountPaise: (await http().get(`/chits/tickets/${t.id}/dues`).set(adminH)).body.totalPayablePaise,
        });
      const ap = await http()
        .post(`/chits/payouts/${payout.id}/approve`)
        .set(adminH)
        .send({ securityVerified: true, note: "Guarantor documents checked" });
      expect(ap.body).toMatchObject({
        status: "APPROVED",
        prizePaise: rs(32_000),
        setOffPaise: rs(8_500),
        netPaise: rs(23_500),
        securityVerified: true,
      });
      expect(
        (await http().post(`/chits/payouts/${payout.id}/approve`).set(adminH).send({ securityVerified: true })).body
          .code,
      ).toBe("BAD_STATE");
      expect(Number((await prisma.chitInstallment.findFirstOrThrow({ where: { ticketId: t1.id } })).paidPaise)).toBe(
        rs(8_500),
      ); // settled from the prize

      const cash = await bal(ACCOUNTS.CASH, r.id);
      const paid = await http()
        .post(`/chits/payouts/${payout.id}/pay`)
        .set(adminH)
        .send({ mode: "CASH", reference: "Signed voucher 17" });
      expect(paid.body).toMatchObject({ status: "PAID", netPaise: rs(23_500), mode: "CASH" });
      expect(cash - (await bal(ACCOUNTS.CASH, r.id))).toBe(rs(23_500));
      expect((await http().post(`/chits/payouts/${payout.id}/pay`).set(adminH).send({ mode: "CASH" })).body.code).toBe(
        "BAD_STATE",
      );
      expect(await prisma.journalEntry.count({ where: { refType: "ChitPayout", refId: payout.id } })).toBe(1);

      // Everything this group holds for members balances: collected - commission - paid out = 0
      const st = (await http().get(`/chits/${r.id}/statement`).set(adminH)).body;
      expect(st.poolBalancePaise).toBe(0);
      expect(st.months[0]).toMatchObject({
        status: "CLOSED",
        winnerTicket: 1,
        prizePaise: rs(32_000),
        payoutStatus: "PAID",
        dueTotalPaise: 4 * rs(8_500),
        collectedPaise: 4 * rs(8_500),
      });
    });

    it("passbook shows each month, payments, dividends received and the prize", async () => {
      const r = await running();
      const t1 = r.tickets[0]!;
      await bid(r.id, 1, t1.id, rs(8_000));
      await close(r.id, 1);
      await pay(t1.id, { amountPaise: rs(2_000) });
      const pb = (await http().get(`/chits/tickets/${t1.id}/passbook`).set(staffH)).body;
      expect(pb.months).toHaveLength(4);
      expect(pb.months[0]).toMatchObject({
        month: 1,
        basePaise: rs(10_000),
        dividendPaise: rs(1_500),
        netDuePaise: rs(8_500),
        paidPaise: rs(2_000) - month1Penalty(),
        outstandingPaise: rs(6_500) + month1Penalty(),
        status: "OVERDUE",
        won: true,
      });
      expect(pb.months[1]).toMatchObject({ status: "UPCOMING", netDuePaise: null });
      expect(pb.prize).toMatchObject({ month: 1, status: "PENDING", prizePaise: rs(32_000) });
      expect(pb.totals).toMatchObject({
        paidPaise: rs(2_000),
        dividendsReceivedPaise: rs(1_500),
        outstandingPaise: rs(6_500) + month1Penalty(),
      });
      expect(pb.payments).toHaveLength(1);
    });

    it("runs a whole two-member chit to completion, and the ledger for the group ends at exactly zero", async () => {
      // Rs 2,000 chit, 2 members, Rs 1,000 subscription, 5% commission = Rs 100, fixed order
      const r = await running({
        name: "Mini",
        type: "FIXED",
        chitValuePaise: rs(2_000),
        members: 2,
        durationMonths: 2,
        monthlySubscriptionPaise: rs(1_000),
        minBidBp: undefined,
        penaltyRateBp: 0,
      });
      expect((await http().post(`/chits/${r.id}/complete`).set(adminH)).body.code).toBe("NOT_SETTLED");

      for (const month of [1, 2]) {
        const c = await close(r.id, month);
        expect(c.body).toMatchObject({
          prizePaise: rs(1_900),
          netInstallmentPaise: rs(1_000),
          winnerTicketNumber: month,
        });
        for (const t of r.tickets) {
          const d = (await http().get(`/chits/tickets/${t.id}/dues`).set(adminH)).body;
          if (d.outstandingPaise)
            await pay(t.id, { amountPaise: d.outstandingPaise, mode: month === 1 ? "CASH" : "BANK_TRANSFER" });
        }
      }
      const payouts = (await http().get("/chits/payouts").query({ groupId: r.id }).set(adminH)).body as {
        id: string;
        status: string;
      }[];
      expect(payouts).toHaveLength(2);
      expect((await http().post(`/chits/${r.id}/complete`).set(adminH)).body.message).toContain("payout");
      for (const p of payouts) {
        await http().post(`/chits/payouts/${p.id}/approve`).set(adminH).send({ securityVerified: true });
        await http().post(`/chits/payouts/${p.id}/pay`).set(adminH).send({ mode: "CASH" });
      }
      const done = await http().post(`/chits/${r.id}/complete`).set(adminH);
      expect(done.status).toBe(200);
      expect(done.body.status).toBe("COMPLETED");

      const st = (await http().get(`/chits/${r.id}/statement`).set(adminH)).body;
      expect(st.poolBalancePaise).toBe(0);
      expect(st.totals.outstandingPaise).toBe(0);
      expect(await bal(ACCOUNTS.CHIT_COMMISSION_INCOME, r.id)).toBe(-rs(200)); // 2 months x Rs 100
      // 4 payments of Rs 1,000 in = 2 payouts of Rs 1,900 out + Rs 200 income
      expect(await bal(ACCOUNTS.CHIT_PAYABLE, r.id)).toBe(0);
      const tb = await ledger.trialBalance();
      expect(tb.balanced).toBe(true);
    });
  });
});
