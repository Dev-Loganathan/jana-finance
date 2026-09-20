import type { INestApplication } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { addDays } from "@jana/shared";
import { today } from "../src/chits/chit.util";
import { ensureRoles, makeApp, makeUser, prisma, token, uniq, type TestUser } from "./helpers";

const rs = (n: number) => n * 100;
const key = () => `pay-${randomBytes(6).toString("hex")}`;

describe("dashboard", () => {
  let app: INestApplication;
  let admin: TestUser;
  let adminH: { Authorization: string };
  let staffH: { Authorization: string };
  const http = () => request(app.getHttpServer());
  const dash = async (h = adminH) => (await http().get("/dashboard").set(h)).body;

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

  const customer = (
    over: { status?: "ACTIVE" | "DRAFT" | "INACTIVE"; kyc?: "VERIFIED" | "PARTIAL"; risk?: "HIGH" | "LOW" } = {},
  ) =>
    prisma.customer.create({
      data: {
        code: `D${uniq("c")}`,
        firstName: "Dash",
        lastName: randomBytes(3).toString("hex"),
        status: over.status ?? "ACTIVE",
        kycStatus: over.kyc ?? "VERIFIED",
        riskLevel: over.risk ?? "LOW",
        createdById: admin.id,
      },
    });

  /** 8-member, Rs 80,000 chit (Rs 10,000 subscription) that has started and had month 1 closed; returns ticket ids. */
  async function groupAfterMonth1(beforeClose?: () => Promise<void>) {
    const g = (
      await http()
        .post("/chits")
        .set(adminH)
        .send({
          name: "Dash test",
          chitValuePaise: rs(80_000),
          members: 8,
          durationMonths: 8,
          monthlySubscriptionPaise: rs(10_000),
          startDate: "2026-06-01",
          auctionDay: 10,
        })
    ).body;
    await http().post(`/chits/${g.id}/open`).set(adminH);
    for (let i = 0; i < 8; i++)
      await http()
        .post(`/chits/${g.id}/members`)
        .set(adminH)
        .send({ customerId: (await customer()).id });
    await http().post(`/chits/${g.id}/start`).set(adminH);
    const tickets = (await http().get(`/chits/${g.id}`).set(adminH)).body.tickets as { id: string }[];
    await http()
      .post(`/chits/${g.id}/cycles/1/bids`)
      .set(adminH)
      .send({ ticketId: tickets[0]!.id, discountPaise: rs(8_000) });
    await beforeClose?.();
    await http().post(`/chits/${g.id}/cycles/1/close`).set(adminH).send({});
    return { id: g.id as string, tickets };
  }

  describe("access", () => {
    it("requires sign-in", async () => expect((await http().get("/dashboard")).status).toBe(401));

    it("shows each user only the sections they may see elsewhere", async () => {
      const role = await prisma.role.create({
        data: { name: `np-${randomBytes(3).toString("hex")}`, permissions: ["audit:view"] },
      });
      const nobody = await makeUser(app, "staff");
      await prisma.user.update({ where: { id: nobody.id }, data: { roleId: role.id } });
      expect(Object.keys(await dash(await token(app, nobody)))).toEqual(["asOf"]);

      const staff = await dash(staffH); // customer, chit, loan and payment view, but no reports
      expect(Object.keys(staff).sort()).toEqual([
        "asOf",
        "chits",
        "collections",
        "customers",
        "followUps",
        "loans",
        "overdue",
      ]);
      expect(staff.cash).toBeUndefined();
      expect(staff.staff).toBeUndefined();

      const owner = await dash();
      expect(Object.keys(owner).sort()).toEqual([
        "asOf",
        "cash",
        "chits",
        "collections",
        "customers",
        "followUps",
        "loans",
        "overdue",
        "staff",
      ]);
      expect(owner.asOf).toBe(today());
    });
  });

  describe("customers", () => {
    it("counts real customers separately from drafts, and pending KYC and high risk among active ones", async () => {
      const b = (await dash()).customers;
      await customer({ status: "DRAFT" });
      let a = (await dash()).customers;
      expect([a.drafts - b.drafts, a.total - b.total]).toEqual([1, 0]);

      await customer({ kyc: "PARTIAL", risk: "HIGH" });
      await customer({ kyc: "VERIFIED", risk: "LOW" });
      await customer({ status: "INACTIVE" });
      a = (await dash()).customers;
      expect(a.total - b.total).toBe(3);
      expect(a.active - b.active).toBe(2);
      expect(a.inactive - b.inactive).toBe(1);
      expect(a.kycPending - b.kycPending).toBe(1);
      expect(a.kyc.VERIFIED - b.kyc.VERIFIED).toBe(1);
      expect(a.kyc.PARTIAL - b.kyc.PARTIAL).toBe(1);
      expect(a.highRisk - b.highRisk).toBe(1);
      expect(a.risk.LOW - b.risk.LOW).toBe(1);
    });
  });

  describe("collections and cash", () => {
    it("adds a payment to today, this month, the monthly series, cash, staff totals and the members' pool, and a reversal takes it out", async () => {
      // Large enough to rank first among staff (the list is capped, and the shared test database holds many collectors);
      // anything above the installment is kept as advance.
      const BIG = rs(10_000_000);
      const g = await groupAfterMonth1();
      const before = await dash();
      const pay = await http()
        .post(`/chits/tickets/${g.tickets[1]!.id}/payments`)
        .set(adminH)
        .set("Idempotency-Key", key())
        .send({ amountPaise: BIG, mode: "CASH", paidOn: today() });
      expect(pay.status).toBe(201);

      const after = await dash();
      const d = (k: string, sel: (x: never) => number) => sel(after as never) - sel(before as never) || 0 * k.length;
      expect(d("today", (x: { collections: { todayPaise: number } }) => x.collections.todayPaise)).toBe(BIG);
      expect(d("month", (x: { collections: { monthPaise: number } }) => x.collections.monthPaise)).toBe(BIG);
      expect(after.collections.months).toHaveLength(6);
      expect(after.collections.months[5].month).toBe(today().slice(0, 7));
      expect(after.collections.months[5].paise - before.collections.months[5].paise).toBe(BIG);
      expect(after.cash.cashPaise - before.cash.cashPaise).toBe(BIG);
      expect(after.cash.heldForMembersPaise - before.cash.heldForMembersPaise).toBe(BIG);
      const me = (x: typeof after) =>
        x.staff.collectionsThisMonth.find((s: { userId: string }) => s.userId === admin.id);
      expect(me(after).paise - (me(before)?.paise ?? 0)).toBe(BIG);

      await http().post(`/chits/payments/${pay.body.id}/reverse`).set(adminH).send({ reason: "test" });
      const reversed = await dash();
      expect(reversed.collections.todayPaise).toBe(before.collections.todayPaise);
      expect(reversed.cash.cashPaise).toBe(before.cash.cashPaise);
    });

    it("does not count a set-off against a prize as money collected", async () => {
      const g = await groupAfterMonth1();
      const payout = (await http().get("/chits/payouts").query({ groupId: g.id }).set(adminH)).body[0];
      const before = (await dash()).collections;
      const ap = await http().post(`/chits/payouts/${payout.id}/approve`).set(adminH).send({ securityVerified: true });
      expect(ap.body.setOffPaise).toBeGreaterThan(0); // the winner's own installment was settled from the prize
      expect((await dash()).collections.monthPaise).toBe(before.monthPaise);
    });
  });

  describe("overdue ageing", () => {
    it("puts each overdue installment in the right days-past-due bucket, at the exact edges", async () => {
      let before: Awaited<ReturnType<typeof dash>>;
      const g = await groupAfterMonth1(async () => void (before = await dash()));
      // After the close, tickets 1..8 each owe one installment. Set their due dates to exact ages.
      const ages = [1, 30, 31, 60, 61, 90, 91];
      const inst = await prisma.chitInstallment.findMany({
        where: { cycle: { groupId: g.id, month: 1 } },
        orderBy: { ticket: { number: "asc" } },
      });
      for (const [i, age] of ages.entries())
        await prisma.chitInstallment.update({
          where: { id: inst[i]!.id },
          data: { dueDate: new Date(`${addDays(today(), -age)}T00:00:00Z`) },
        });
      // the 8th installment is paid in full, so it is not overdue at all
      await http()
        .post(`/chits/tickets/${g.tickets[7]!.id}/payments`)
        .set(adminH)
        .set("Idempotency-Key", key())
        .send({ amountPaise: Number(inst[7]!.netDuePaise), mode: "CASH" });

      const after = await dash();
      const net = Number(inst[0]!.netDuePaise);
      const delta = (bucket: string) => {
        const a = after.overdue.buckets.find((x: { bucket: string }) => x.bucket === bucket);
        const b = before.overdue.buckets.find((x: { bucket: string }) => x.bucket === bucket);
        return { count: a.count - b.count, paise: a.paise - b.paise };
      };
      expect(delta("0-30")).toEqual({ count: 2, paise: 2 * net });
      expect(delta("31-60")).toEqual({ count: 2, paise: 2 * net });
      expect(delta("61-90")).toEqual({ count: 2, paise: 2 * net });
      expect(delta("90+")).toEqual({ count: 1, paise: net });
      expect(after.overdue.totalPaise - before.overdue.totalPaise).toBe(7 * net);
      expect(after.overdue.members - before.overdue.members).toBe(7);
      expect(after.overdue.buckets.map((b: { bucket: string }) => b.bucket)).toEqual(["0-30", "31-60", "61-90", "90+"]);

      // top defaulters are the largest overdue balances, biggest first
      const top = after.overdue.topDefaulters as { overduePaise: number; name: string }[];
      expect(top.length).toBeLessThanOrEqual(5);
      expect([...top].sort((x, y) => y.overduePaise - x.overduePaise)).toEqual(top);
    });
  });

  describe("chits", () => {
    it("lists each running group's next unclosed auction, flagging ones that are overdue to be held", async () => {
      const g = await groupAfterMonth1(); // month 1 closed; month 2 (2026-07-10) is next and already past
      const c = (await dash()).chits;
      const mine = c.upcomingAuctions.find((a: { groupId: string }) => a.groupId === g.id);
      // Upcoming list is capped and shared with other tests' groups, so check it when present and check the rule directly.
      if (mine) expect(mine).toMatchObject({ month: 2, date: "2026-07-10", overdue: true });
      expect(c.running).toBeGreaterThan(0);
      expect(c.pendingPayouts).toBeGreaterThan(0);
      expect(c.upcomingAuctions.every((a: { date: string; overdue: boolean }) => a.overdue === a.date < today())).toBe(
        true,
      );
      expect(c.upcomingAuctions.length).toBeLessThanOrEqual(8);
      const dates = c.upcomingAuctions.map((a: { date: string }) => a.date);
      expect([...dates].sort()).toEqual(dates);
    });
  });
});
