import { Injectable } from "@nestjs/common";
import { addDays } from "@jana/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ACCOUNTS, LedgerService } from "../ledger/ledger.service";
import type { AuthUser } from "../common/decorators";
import { num, today } from "../chits/chit.util";

/** Days-past-due buckets from the brief. Overdue means at least one day late. */
export const DPD_BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;

const month = (d: string) => d.slice(0, 7);
const firstOfMonth = (d: string) => `${month(d)}-01`;

/** The first day of the month `back` months before the month of `d`. */
function monthsBack(d: string, back: number): string {
  const [y, m] = d.split("-").map(Number) as [number, number];
  const t = m - 1 - back;
  return `${y + Math.floor(t / 12)}-${String((((t % 12) + 12) % 12) + 1).padStart(2, "0")}-01`;
}

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
  ) {}

  /**
   * The owner's dashboard. Every section is included only if the caller holds the permission that would let them see the
   * same data elsewhere, so the dashboard never reveals more than the rest of the app.
   */
  async get(actor: AuthUser) {
    const can = (p: string) => actor.permissions.includes(p as never);
    const now = today();
    const out: Record<string, unknown> = { asOf: now };
    const jobs: Promise<void>[] = [];

    if (can("customer:view")) jobs.push(this.customers().then((v) => void (out.customers = v)));
    if (can("chit:view")) jobs.push(this.chits(now).then((v) => void (out.chits = v)));
    if (can("payment:view")) {
      jobs.push(this.collections(now).then((v) => void (out.collections = v)));
      jobs.push(this.overdue(now).then((v) => void (out.overdue = v)));
    }
    if (can("customer:view")) jobs.push(this.followUps(now).then((v) => void (out.followUps = v)));
    if (can("report:view")) {
      jobs.push(this.cash().then((v) => void (out.cash = v)));
      jobs.push(this.staff(now).then((v) => void (out.staff = v)));
    }
    await Promise.all(jobs);
    return out;
  }

  private async customers() {
    const [byStatus, byKyc, byRisk, byWatch] = await Promise.all([
      this.prisma.customer.groupBy({ by: ["status"], where: { deletedAt: null }, _count: true }),
      this.prisma.customer.groupBy({ by: ["kycStatus"], where: { deletedAt: null, status: "ACTIVE" }, _count: true }),
      this.prisma.customer.groupBy({ by: ["riskLevel"], where: { deletedAt: null, status: "ACTIVE" }, _count: true }),
      this.prisma.customer.groupBy({
        by: ["watchStatus"],
        where: { deletedAt: null, watchStatus: { not: "NONE" } },
        _count: true,
      }),
    ]);
    const c = (rows: { _count: number }[], pick: (r: never) => boolean) =>
      rows.filter((r) => pick(r as never)).reduce((s, r) => s + r._count, 0);
    const status = (s: string) => c(byStatus, (r: { status: string }) => r.status === s);
    const kyc = (k: string) => c(byKyc, (r: { kycStatus: string }) => r.kycStatus === k);
    return {
      total: status("ACTIVE") + status("INACTIVE"),
      active: status("ACTIVE"),
      inactive: status("INACTIVE"),
      drafts: status("DRAFT"),
      highRisk: c(byRisk, (r: { riskLevel: string | null }) => r.riskLevel === "HIGH"),
      // Active customers whose KYC is not fully verified yet
      kycPending: kyc("NOT_STARTED") + kyc("PARTIAL") + kyc("COMPLETE") + kyc("EXPIRED"),
      kyc: {
        VERIFIED: kyc("VERIFIED"),
        COMPLETE: kyc("COMPLETE"),
        PARTIAL: kyc("PARTIAL"),
        NOT_STARTED: kyc("NOT_STARTED"),
        EXPIRED: kyc("EXPIRED"),
      },
      risk: {
        LOW: c(byRisk, (r: { riskLevel: string | null }) => r.riskLevel === "LOW"),
        MEDIUM: c(byRisk, (r: { riskLevel: string | null }) => r.riskLevel === "MEDIUM"),
        HIGH: c(byRisk, (r: { riskLevel: string | null }) => r.riskLevel === "HIGH"),
      },
      watchlist: c(byWatch, (r: { watchStatus: string }) => r.watchStatus === "WATCHLIST"),
      blacklist: c(byWatch, (r: { watchStatus: string }) => r.watchStatus === "BLACKLIST"),
    };
  }

  private async chits(now: string) {
    const [groups, cycles, pendingPayouts] = await Promise.all([
      this.prisma.chitGroup.groupBy({ by: ["status"], where: { deletedAt: null }, _count: true }),
      this.prisma.chitCycle.findMany({
        where: { status: "SCHEDULED", group: { status: "RUNNING", deletedAt: null } },
        orderBy: [{ groupId: "asc" }, { month: "asc" }],
        include: { group: { select: { id: true, code: true, name: true } } },
      }),
      this.prisma.chitPayout.aggregate({ where: { status: { not: "PAID" } }, _count: true, _sum: { netPaise: true } }),
    ]);
    const n = (s: string) => groups.filter((g) => g.status === s).reduce((t, g) => t + g._count, 0);
    // Only each group's next unclosed month matters; later months are simply "scheduled".
    const nextPerGroup = [...new Map(cycles.map((c) => [c.groupId, c])).values()].sort(
      (a, b) => a.auctionDate.getTime() - b.auctionDate.getTime(),
    );
    const horizon = addDays(now, 30);
    return {
      running: n("RUNNING"),
      open: n("OPEN_FOR_ENROLMENT"),
      draft: n("DRAFT"),
      completed: n("COMPLETED"),
      pendingPayouts: pendingPayouts._count,
      pendingPayoutsPaise: num(pendingPayouts._sum.netPaise),
      upcomingAuctions: nextPerGroup
        .map((c) => ({
          groupId: c.group.id,
          code: c.group.code,
          name: c.group.name,
          month: c.month,
          date: c.auctionDate.toISOString().slice(0, 10),
        }))
        .filter((a) => a.date <= horizon)
        .slice(0, 8)
        .map((a) => ({ ...a, overdue: a.date < now })),
    };
  }

  private async collections(now: string) {
    const monthStart = firstOfMonth(now);
    const from = monthsBack(now, 5);
    const real = { status: "POSTED" as const, mode: { not: "SET_OFF" as const } };
    const [todaySum, monthSum, series] = await Promise.all([
      this.prisma.chitPayment.aggregate({
        where: { ...real, paidOn: new Date(`${now}T00:00:00Z`) },
        _sum: { amountPaise: true },
        _count: true,
      }),
      this.prisma.chitPayment.aggregate({
        where: { ...real, paidOn: { gte: new Date(`${monthStart}T00:00:00Z`), lte: new Date(`${now}T00:00:00Z`) } },
        _sum: { amountPaise: true },
        _count: true,
      }),
      this.prisma.$queryRaw<{ m: string; amt: bigint }[]>`
        SELECT to_char("paidOn", 'YYYY-MM') AS m, SUM("amountPaise")::bigint AS amt FROM "ChitPayment"
        WHERE status = 'POSTED'::"PaymentStatus" AND mode <> 'SET_OFF'::"PayMode" AND "paidOn" >= ${from}::date AND "paidOn" <= ${now}::date GROUP BY 1`,
    ]);
    const byMonth = new Map(series.map((r) => [r.m, Number(r.amt)]));
    return {
      todayPaise: num(todaySum._sum.amountPaise),
      todayCount: todaySum._count,
      monthPaise: num(monthSum._sum.amountPaise),
      monthCount: monthSum._count,
      // Always six points, oldest first, so a quiet month shows as zero rather than disappearing
      months: Array.from({ length: 6 }, (_, i) => {
        const m = month(monthsBack(now, 5 - i));
        return { month: m, paise: byMonth.get(m) ?? 0 };
      }),
    };
  }

  private async overdue(now: string) {
    const [buckets, totals, top] = await Promise.all([
      this.prisma.$queryRaw<{ bucket: string; n: number; amt: bigint }[]>`
        SELECT CASE WHEN (${now}::date - i."dueDate") <= 30 THEN '0-30' WHEN (${now}::date - i."dueDate") <= 60 THEN '31-60'
                    WHEN (${now}::date - i."dueDate") <= 90 THEN '61-90' ELSE '90+' END AS bucket,
               COUNT(*)::int AS n, SUM(i."netDuePaise" - i."paidPaise")::bigint AS amt
        FROM "ChitInstallment" i JOIN "ChitCycle" c ON c.id = i."cycleId" JOIN "ChitGroup" g ON g.id = c."groupId"
        WHERE i."netDuePaise" IS NOT NULL AND i."paidPaise" < i."netDuePaise" AND i."dueDate" < ${now}::date AND g."deletedAt" IS NULL
        GROUP BY 1`,
      this.prisma.$queryRaw<{ members: number; amt: bigint | null }[]>`
        SELECT COUNT(DISTINCT i."ticketId")::int AS members, SUM(i."netDuePaise" - i."paidPaise")::bigint AS amt
        FROM "ChitInstallment" i JOIN "ChitCycle" c ON c.id = i."cycleId" JOIN "ChitGroup" g ON g.id = c."groupId"
        WHERE i."netDuePaise" IS NOT NULL AND i."paidPaise" < i."netDuePaise" AND i."dueDate" < ${now}::date AND g."deletedAt" IS NULL`,
      this.prisma.$queryRaw<{ customerId: string; amt: bigint; dpd: number; tickets: number }[]>`
        SELECT t."customerId", SUM(i."netDuePaise" - i."paidPaise")::bigint AS amt, MAX(${now}::date - i."dueDate")::int AS dpd, COUNT(DISTINCT t.id)::int AS tickets
        FROM "ChitInstallment" i JOIN "ChitCycle" c ON c.id = i."cycleId" JOIN "ChitGroup" g ON g.id = c."groupId" JOIN "ChitTicket" t ON t.id = i."ticketId"
        WHERE i."netDuePaise" IS NOT NULL AND i."paidPaise" < i."netDuePaise" AND i."dueDate" < ${now}::date AND g."deletedAt" IS NULL AND t."customerId" IS NOT NULL
        GROUP BY t."customerId" ORDER BY amt DESC LIMIT 5`,
    ]);
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: top.map((t) => t.customerId) } },
      select: { id: true, code: true, firstName: true, lastName: true, phone: true },
    });
    const by = new Map(buckets.map((b) => [b.bucket, b]));
    return {
      totalPaise: num(totals[0]?.amt),
      members: totals[0]?.members ?? 0,
      buckets: DPD_BUCKETS.map((b) => ({ bucket: b, count: by.get(b)?.n ?? 0, paise: num(by.get(b)?.amt) })),
      topDefaulters: top.map((t) => {
        const c = customers.find((x) => x.id === t.customerId);
        return {
          customerId: t.customerId,
          code: c?.code ?? "",
          name: c ? `${c.firstName} ${c.lastName}`.trim() : "",
          phone: c?.phone ?? null,
          overduePaise: num(t.amt),
          daysPastDue: t.dpd,
          tickets: t.tickets,
        };
      }),
    };
  }

  private async cash() {
    const [cash, bank, held] = await Promise.all([
      this.ledger.balance(ACCOUNTS.CASH),
      this.ledger.balance(ACCOUNTS.BANK),
      this.ledger.balance(ACCOUNTS.CHIT_PAYABLE),
    ]);
    return { cashPaise: cash, bankPaise: bank, totalPaise: cash + bank, heldForMembersPaise: -held };
  }

  private async staff(now: string) {
    const rows = await this.prisma.chitPayment.groupBy({
      by: ["receivedById"],
      where: {
        status: "POSTED",
        mode: { not: "SET_OFF" },
        paidOn: { gte: new Date(`${firstOfMonth(now)}T00:00:00Z`), lte: new Date(`${now}T00:00:00Z`) },
      },
      _sum: { amountPaise: true },
      _count: true,
      orderBy: { _sum: { amountPaise: "desc" } },
      take: 8,
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.receivedById) } },
      select: { id: true, firstName: true, lastName: true },
    });
    return {
      collectionsThisMonth: rows.map((r) => {
        const u = users.find((x) => x.id === r.receivedById);
        return {
          userId: r.receivedById,
          name: u ? `${u.firstName} ${u.lastName}`.trim() : "Unknown",
          paise: num(r._sum.amountPaise),
          receipts: r._count,
        };
      }),
    };
  }

  private async followUps(now: string) {
    const [due, overdue] = await Promise.all([
      this.prisma.customerNote.count({
        where: { completedAt: null, followUpOn: new Date(`${now}T00:00:00Z`), customer: { deletedAt: null } },
      }),
      this.prisma.customerNote.count({
        where: { completedAt: null, followUpOn: { lt: new Date(`${now}T00:00:00Z`) }, customer: { deletedAt: null } },
      }),
    ]);
    return { dueToday: due, overdue };
  }
}
