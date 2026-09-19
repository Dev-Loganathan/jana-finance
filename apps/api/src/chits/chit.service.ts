import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  bpOf,
  buildSchedule,
  computeAuction,
  validateChitConfig,
  type ChitConfig,
  type CreateChitGroupInput,
} from "@jana/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ACCOUNTS, LedgerService } from "../ledger/ledger.service";
import type { AuthUser, ReqCtx } from "../common/decorators";
import { dateStr, num, toCycleDto, toGroupDto } from "./chit.util";

const KYC_OK = new Set(["COMPLETE", "VERIFIED"]);
const ymd = (s: string) => new Date(`${s}T00:00:00Z`);

@Injectable()
export class ChitService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private ledger: LedgerService,
  ) {}

  /* ---------------- groups ---------------- */

  private async loadGroup(id: string, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    const g = await tx.chitGroup.findFirst({ where: { id, deletedAt: null } });
    if (!g) throw new NotFoundException({ code: "NOT_FOUND", message: "Chit group not found" });
    return g;
  }

  async list(q: { page: number; pageSize: number; q?: string; status?: string }) {
    const where: Prisma.ChitGroupWhereInput = { deletedAt: null };
    if (q.status) where.status = q.status as never;
    if (q.q)
      where.OR = [{ name: { contains: q.q, mode: "insensitive" } }, { code: { contains: q.q, mode: "insensitive" } }];
    const [rows, total] = await Promise.all([
      this.prisma.chitGroup.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          tickets: { select: { customerId: true } },
          cycles: { where: { status: "CLOSED" }, select: { id: true } },
        },
      }),
      this.prisma.chitGroup.count({ where }),
    ]);
    return {
      items: rows.map((g) => toGroupDto(g, g.tickets, g.cycles.length)),
      page: q.page,
      pageSize: q.pageSize,
      total,
    };
  }

  async get(id: string) {
    const g = await this.loadGroup(id);
    const [tickets, cycles, waitlist] = await Promise.all([
      this.prisma.chitTicket.findMany({ where: { groupId: id }, orderBy: { number: "asc" } }),
      this.prisma.chitCycle.findMany({ where: { groupId: id }, orderBy: { month: "asc" } }),
      this.prisma.chitWaitlist.findMany({ where: { groupId: id }, orderBy: { createdAt: "asc" } }),
    ]);
    const ids = [
      ...new Set(
        [...tickets.map((t) => t.customerId), ...waitlist.map((w) => w.customerId)].filter((x): x is string => !!x),
      ),
    ];
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, firstName: true, lastName: true, phone: true },
    });
    const who = new Map(
      customers.map((c) => [
        c.id,
        { id: c.id, code: c.code, name: `${c.firstName} ${c.lastName}`.trim(), phone: c.phone },
      ]),
    );
    return {
      ...toGroupDto(g, tickets, cycles.filter((c) => c.status === "CLOSED").length),
      tickets: tickets.map((t) => ({
        id: t.id,
        number: t.number,
        customer: t.customerId ? (who.get(t.customerId) ?? null) : null,
        prized: t.prized,
        prizedMonth: t.prizedMonth,
        payoutOrder: t.payoutOrder,
        advancePaise: num(t.advancePaise),
      })),
      cycles: cycles.map(toCycleDto),
      waitlist: waitlist.map((w) => ({
        id: w.id,
        customer: who.get(w.customerId) ?? null,
        note: w.note,
        createdAt: w.createdAt,
      })),
    };
  }

  async create(actor: AuthUser, input: CreateChitGroupInput, ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const seq = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('chit_group_seq')`;
      const g = await tx.chitGroup.create({
        data: {
          code: `CHIT${String(seq[0]!.nextval).padStart(3, "0")}`,
          name: input.name,
          type: input.type,
          chitValuePaise: BigInt(input.chitValuePaise),
          members: input.members,
          durationMonths: input.durationMonths,
          monthlySubscriptionPaise: BigInt(input.monthlySubscriptionPaise),
          commissionBp: input.commissionBp,
          minBidBp: input.minBidBp ?? input.commissionBp,
          maxBidBp: input.maxBidBp,
          startDate: ymd(input.startDate),
          auctionDay: input.auctionDay,
          dueDaysAfterAuction: input.dueDaysAfterAuction,
          penaltyRateBp: input.penaltyRateBp,
          penaltyGraceDays: input.penaltyGraceDays,
          registrationFeePaise: BigInt(input.registrationFeePaise),
          notes: input.notes,
          createdById: actor.id,
        },
      });
      await tx.chitTicket.createMany({
        data: Array.from({ length: input.members }, (_, i) => ({ groupId: g.id, number: i + 1, payoutOrder: i + 1 })),
      });
      await this.audit.record(
        ctx,
        {
          action: "chit.group_created",
          entity: "ChitGroup",
          entityId: g.id,
          after: { code: g.code, name: g.name, members: g.members },
        },
        tx,
      );
      return toGroupDto(g, [], 0);
    });
  }

  async update(id: string, patch: Partial<CreateChitGroupInput>, ctx: ReqCtx) {
    const g = await this.loadGroup(id);
    const structural: (keyof CreateChitGroupInput)[] = [
      "type",
      "chitValuePaise",
      "members",
      "durationMonths",
      "monthlySubscriptionPaise",
      "commissionBp",
      "minBidBp",
      "maxBidBp",
      "startDate",
      "auctionDay",
      "dueDaysAfterAuction",
      "registrationFeePaise",
    ];
    if (g.status !== "DRAFT" && structural.some((k) => patch[k] !== undefined)) {
      throw new BadRequestException({
        code: "LOCKED",
        message: "Only the name, notes and penalty settings can change once a group is open for enrolment",
      });
    }
    const merged: ChitConfig & { type: typeof g.type } = {
      type: (patch.type ?? g.type) as typeof g.type,
      chitValuePaise: patch.chitValuePaise ?? num(g.chitValuePaise),
      members: patch.members ?? g.members,
      durationMonths: patch.durationMonths ?? g.durationMonths,
      monthlySubscriptionPaise: patch.monthlySubscriptionPaise ?? num(g.monthlySubscriptionPaise),
      commissionBp: patch.commissionBp ?? g.commissionBp,
      minBidBp: patch.minBidBp ?? g.minBidBp,
      maxBidBp: patch.maxBidBp ?? g.maxBidBp,
    };
    const errors = validateChitConfig(merged, merged.type);
    if (errors.length)
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: errors.join("; "),
        errors: { formErrors: errors, fieldErrors: {} },
      });

    return this.prisma.$transaction(async (tx) => {
      const data: Prisma.ChitGroupUpdateInput = {
        name: patch.name,
        notes: patch.notes,
        penaltyRateBp: patch.penaltyRateBp,
        penaltyGraceDays: patch.penaltyGraceDays,
      };
      if (g.status === "DRAFT") {
        Object.assign(data, {
          type: patch.type,
          chitValuePaise: patch.chitValuePaise === undefined ? undefined : BigInt(patch.chitValuePaise),
          members: patch.members,
          durationMonths: patch.durationMonths,
          monthlySubscriptionPaise:
            patch.monthlySubscriptionPaise === undefined ? undefined : BigInt(patch.monthlySubscriptionPaise),
          commissionBp: patch.commissionBp,
          minBidBp:
            patch.minBidBp ??
            (patch.commissionBp !== undefined && patch.commissionBp > g.minBidBp ? patch.commissionBp : undefined),
          maxBidBp: patch.maxBidBp,
          startDate: patch.startDate ? ymd(patch.startDate) : undefined,
          auctionDay: patch.auctionDay,
          dueDaysAfterAuction: patch.dueDaysAfterAuction,
          registrationFeePaise:
            patch.registrationFeePaise === undefined ? undefined : BigInt(patch.registrationFeePaise),
        });
        if (patch.members !== undefined && patch.members !== g.members) {
          // Draft groups have no members yet, so the seats can simply be rebuilt.
          await tx.chitTicket.deleteMany({ where: { groupId: id } });
          await tx.chitTicket.createMany({
            data: Array.from({ length: patch.members }, (_, i) => ({ groupId: id, number: i + 1, payoutOrder: i + 1 })),
          });
        }
      }
      const u = await tx.chitGroup.update({ where: { id }, data });
      await this.audit.record(
        ctx,
        {
          action: "chit.group_updated",
          entity: "ChitGroup",
          entityId: id,
          before: toGroupDto(g),
          after: toGroupDto(u),
        },
        tx,
      );
      return toGroupDto(u);
    });
  }

  async setStatus(id: string, action: "open" | "cancel", reason: string | undefined, ctx: ReqCtx) {
    const g = await this.loadGroup(id);
    if (action === "open") {
      if (g.status !== "DRAFT")
        throw new BadRequestException({ code: "BAD_STATE", message: "Only draft groups can be opened for enrolment" });
    } else if (g.status !== "DRAFT" && g.status !== "OPEN_FOR_ENROLMENT") {
      throw new BadRequestException({
        code: "BAD_STATE",
        message: "Only groups that have not started can be cancelled",
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const u = await tx.chitGroup.update({
        where: { id },
        data: action === "open" ? { status: "OPEN_FOR_ENROLMENT" } : { status: "CANCELLED", cancelledReason: reason },
      });
      await this.audit.record(
        ctx,
        {
          action: action === "open" ? "chit.group_opened" : "chit.group_cancelled",
          entity: "ChitGroup",
          entityId: id,
          before: { status: g.status },
          after: { status: u.status, reason },
        },
        tx,
      );
      return toGroupDto(u);
    });
  }

  async clone(actor: AuthUser, id: string, ctx: ReqCtx) {
    const g = await this.loadGroup(id);
    const nextStart = new Date(g.startDate);
    nextStart.setUTCFullYear(nextStart.getUTCFullYear() + Math.ceil(g.durationMonths / 12));
    return this.create(
      actor,
      {
        name: `${g.name} (copy)`,
        type: g.type,
        chitValuePaise: num(g.chitValuePaise),
        members: g.members,
        durationMonths: g.durationMonths,
        monthlySubscriptionPaise: num(g.monthlySubscriptionPaise),
        commissionBp: g.commissionBp,
        minBidBp: g.minBidBp,
        maxBidBp: g.maxBidBp,
        startDate: dateStr(nextStart)!,
        auctionDay: g.auctionDay,
        dueDaysAfterAuction: g.dueDaysAfterAuction,
        penaltyRateBp: g.penaltyRateBp,
        penaltyGraceDays: g.penaltyGraceDays,
        registrationFeePaise: num(g.registrationFeePaise),
        notes: g.notes ?? undefined,
      },
      ctx,
    );
  }

  /** Locks the membership and generates the month-by-month schedule and every ticket's installments. */
  async start(id: string, ctx: ReqCtx) {
    const g = await this.loadGroup(id);
    if (g.status !== "OPEN_FOR_ENROLMENT")
      throw new BadRequestException({ code: "BAD_STATE", message: "Open the group for enrolment first" });
    const tickets = await this.prisma.chitTicket.findMany({ where: { groupId: id }, orderBy: { number: "asc" } });
    const vacant = tickets.filter((t) => !t.customerId).length;
    if (vacant > 0)
      throw new BadRequestException({
        code: "SEATS_VACANT",
        message: `${vacant} seat${vacant === 1 ? " is" : "s are"} still vacant. Fill every seat before starting.`,
      });

    const schedule = buildSchedule(dateStr(g.startDate)!, g.auctionDay, g.durationMonths, g.dueDaysAfterAuction);
    return this.prisma.$transaction(async (tx) => {
      for (const s of schedule) {
        const cycle = await tx.chitCycle.create({
          data: {
            groupId: id,
            month: s.month,
            auctionDate: ymd(s.auctionDate),
            dueDate: ymd(s.dueDate),
            method: g.type,
          },
        });
        await tx.chitInstallment.createMany({
          data: tickets.map((t) => ({
            cycleId: cycle.id,
            ticketId: t.id,
            dueDate: ymd(s.dueDate),
            basePaise: g.monthlySubscriptionPaise,
          })),
        });
      }
      const u = await tx.chitGroup.update({ where: { id }, data: { status: "RUNNING" } });
      await this.audit.record(
        ctx,
        {
          action: "chit.group_started",
          entity: "ChitGroup",
          entityId: id,
          after: { months: schedule.length, firstAuction: schedule[0]!.auctionDate },
        },
        tx,
      );
      return toGroupDto(u);
    });
  }

  async complete(id: string, ctx: ReqCtx) {
    const g = await this.loadGroup(id);
    if (g.status !== "RUNNING")
      throw new BadRequestException({ code: "BAD_STATE", message: "Only running groups can be completed" });
    const [open, unpaidPayouts, unpaid] = await Promise.all([
      this.prisma.chitCycle.count({ where: { groupId: id, status: { not: "CLOSED" } } }),
      this.prisma.chitPayout.count({ where: { groupId: id, status: { not: "PAID" } } }),
      this.prisma.$queryRaw<
        { n: bigint }[]
      >`SELECT COUNT(*)::bigint AS n FROM "ChitInstallment" i JOIN "ChitCycle" c ON c.id = i."cycleId" WHERE c."groupId" = ${id}::uuid AND (i."netDuePaise" IS NULL OR i."paidPaise" < i."netDuePaise")`,
    ]);
    const problems = [
      open && `${open} auction(s) not held`,
      unpaidPayouts && `${unpaidPayouts} prize payout(s) not paid`,
      Number(unpaid[0]!.n) && `${Number(unpaid[0]!.n)} installment(s) not fully paid`,
    ].filter(Boolean);
    if (problems.length)
      throw new BadRequestException({ code: "NOT_SETTLED", message: `Cannot complete yet: ${problems.join(", ")}` });
    return this.prisma.$transaction(async (tx) => {
      const u = await tx.chitGroup.update({ where: { id }, data: { status: "COMPLETED" } });
      await this.audit.record(ctx, { action: "chit.group_completed", entity: "ChitGroup", entityId: id }, tx);
      return toGroupDto(u);
    });
  }

  /* ---------------- members ---------------- */

  private async assertEligibleMember(customerId: string) {
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, deletedAt: null } });
    if (!c) throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND", message: "Customer not found" });
    if (c.status !== "ACTIVE")
      throw new BadRequestException({
        code: "CUSTOMER_NOT_ACTIVE",
        message: "Only active customers can join a chit group",
      });
    if (c.watchStatus === "BLACKLIST")
      throw new BadRequestException({
        code: "CUSTOMER_BLACKLISTED",
        message: "This customer is blacklisted and cannot join a chit group",
      });
    if (!KYC_OK.has(c.kycStatus))
      throw new BadRequestException({
        code: "KYC_INCOMPLETE",
        message: "Complete the customer's KYC (Aadhaar, PAN and photo) before enrolling them",
      });
    return c;
  }

  async enrol(id: string, input: { customerId: string; ticketNumber?: number }, ctx: ReqCtx) {
    const g = await this.loadGroup(id);
    if (g.status !== "OPEN_FOR_ENROLMENT")
      throw new BadRequestException({
        code: "BAD_STATE",
        message: "Enrolment is open only for groups that are open for enrolment",
      });
    const customer = await this.assertEligibleMember(input.customerId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ChitGroup" WHERE id = ${id}::uuid FOR UPDATE`; // serialise enrolments so two people cannot take the same seat
      const vacant = await tx.chitTicket.findMany({
        where: { groupId: id, customerId: null },
        orderBy: { number: "asc" },
      });
      if (vacant.length === 0)
        throw new ConflictException({
          code: "GROUP_FULL",
          message: "Every seat is taken. Add the customer to the waiting list.",
        });
      const seat = input.ticketNumber ? vacant.find((t) => t.number === input.ticketNumber) : vacant[0];
      if (!seat)
        throw new ConflictException({ code: "SEAT_TAKEN", message: `Ticket ${input.ticketNumber} is not available` });
      const t = await tx.chitTicket.update({
        where: { id: seat.id },
        data: { customerId: customer.id, joinedAt: new Date() },
      });
      await tx.chitWaitlist.deleteMany({ where: { groupId: id, customerId: customer.id } });
      await this.audit.record(
        ctx,
        {
          action: "chit.member_enrolled",
          entity: "ChitGroup",
          entityId: id,
          after: { ticket: t.number, customer: customer.code },
        },
        tx,
      );
      return { ticketId: t.id, number: t.number, customerId: customer.id };
    });
  }

  async vacate(id: string, ticketId: string, ctx: ReqCtx) {
    const g = await this.loadGroup(id);
    if (g.status === "RUNNING" || g.status === "COMPLETED")
      throw new BadRequestException({
        code: "BAD_STATE",
        message: "Members cannot leave once the group has started. Use a transfer instead.",
      });
    const t = await this.prisma.chitTicket.findFirst({ where: { id: ticketId, groupId: id } });
    if (!t?.customerId) throw new NotFoundException({ code: "NOT_FOUND", message: "That seat is already vacant" });
    await this.prisma.$transaction(async (tx) => {
      await tx.chitTicket.update({ where: { id: ticketId }, data: { customerId: null, joinedAt: null } });
      await this.audit.record(
        ctx,
        {
          action: "chit.member_removed",
          entity: "ChitGroup",
          entityId: id,
          before: { ticket: t.number, customerId: t.customerId },
        },
        tx,
      );
    });
  }

  async addToWaitlist(id: string, customerId: string, note: string | undefined, ctx: ReqCtx) {
    const g = await this.loadGroup(id);
    if (g.status === "COMPLETED" || g.status === "CANCELLED")
      throw new BadRequestException({ code: "BAD_STATE", message: "This group is closed" });
    await this.assertEligibleMember(customerId);
    if (await this.prisma.chitTicket.findFirst({ where: { groupId: id, customerId } }))
      throw new ConflictException({
        code: "ALREADY_MEMBER",
        message: "This customer already has a ticket in this group",
      });
    return this.prisma.$transaction(async (tx) => {
      const w = await tx.chitWaitlist.upsert({
        where: { groupId_customerId: { groupId: id, customerId } },
        create: { groupId: id, customerId, note },
        update: { note },
      });
      await this.audit.record(
        ctx,
        { action: "chit.waitlist_added", entity: "ChitGroup", entityId: id, after: { customerId } },
        tx,
      );
      return { id: w.id };
    });
  }

  async removeFromWaitlist(id: string, waitId: string) {
    await this.prisma.chitWaitlist.deleteMany({ where: { id: waitId, groupId: id } });
  }

  /** Hands a ticket (with its dues and prize status) to another customer. Approval workflow plugs in later. */
  async transfer(id: string, ticketId: string, toCustomerId: string, reason: string, actor: AuthUser, ctx: ReqCtx) {
    const g = await this.loadGroup(id);
    if (g.status !== "OPEN_FOR_ENROLMENT" && g.status !== "RUNNING")
      throw new BadRequestException({
        code: "BAD_STATE",
        message: "Tickets can only be transferred while the group is open or running",
      });
    const t = await this.prisma.chitTicket.findFirst({ where: { id: ticketId, groupId: id } });
    if (!t?.customerId)
      throw new NotFoundException({ code: "NOT_FOUND", message: "That ticket has no member to transfer from" });
    if (t.customerId === toCustomerId)
      throw new BadRequestException({ code: "SAME_CUSTOMER", message: "The ticket already belongs to this customer" });
    await this.assertEligibleMember(toCustomerId);
    return this.prisma.$transaction(async (tx) => {
      await tx.chitTicket.update({ where: { id: ticketId }, data: { customerId: toCustomerId } });
      await tx.chitTransfer.create({
        data: { ticketId, fromCustomerId: t.customerId!, toCustomerId, reason, byUserId: actor.id },
      });
      await this.audit.record(
        ctx,
        {
          action: "chit.ticket_transferred",
          entity: "ChitGroup",
          entityId: id,
          before: { ticket: t.number, customerId: t.customerId },
          after: { customerId: toCustomerId, reason },
        },
        tx,
      );
      return { ticketId, number: t.number, customerId: toCustomerId };
    });
  }

  /** Every group and ticket a customer holds, with what they owe. */
  async byCustomer(customerId: string) {
    const tickets = await this.prisma.chitTicket.findMany({
      where: { customerId },
      include: {
        group: true,
        installments: { where: { netDuePaise: { not: null } }, select: { netDuePaise: true, paidPaise: true } },
      },
    });
    return tickets
      .filter((t) => !t.group.deletedAt)
      .map((t) => ({
        ticketId: t.id,
        number: t.number,
        prized: t.prized,
        group: {
          id: t.group.id,
          code: t.group.code,
          name: t.group.name,
          status: t.group.status,
          chitValuePaise: num(t.group.chitValuePaise),
        },
        outstandingPaise: t.installments.reduce((s, i) => s + Math.max(0, num(i.netDuePaise) - num(i.paidPaise)), 0),
        advancePaise: num(t.advancePaise),
      }));
  }

  /* ---------------- cycles and the auction ---------------- */

  private async cycleOf(groupId: string, month: number, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    const c = await tx.chitCycle.findUnique({ where: { groupId_month: { groupId, month } } });
    if (!c) throw new NotFoundException({ code: "NOT_FOUND", message: "That month does not exist in this group" });
    return c;
  }

  /** Tickets that may take part this month: not yet prized, and not in arrears for earlier months. */
  private async eligibleTickets(
    groupId: string,
    auctionDate: Date,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const tickets = await tx.chitTicket.findMany({
      where: { groupId, customerId: { not: null }, prized: false },
      orderBy: { number: "asc" },
    });
    const arrears = await tx.$queryRaw<{ ticketId: string }[]>`
      SELECT DISTINCT i."ticketId" FROM "ChitInstallment" i JOIN "ChitCycle" c ON c.id = i."cycleId"
      WHERE c."groupId" = ${groupId}::uuid AND i."netDuePaise" IS NOT NULL AND i."paidPaise" < i."netDuePaise" AND i."dueDate" < ${auctionDate}::date`;
    const bad = new Set(arrears.map((a) => a.ticketId));
    return tickets.map((t) => ({ ticket: t, inArrears: bad.has(t.id) }));
  }

  async cycleDetail(groupId: string, month: number) {
    const g = await this.loadGroup(groupId);
    const c = await this.cycleOf(groupId, month);
    const [bids, eligible] = await Promise.all([
      this.prisma.chitBid.findMany({ where: { cycleId: c.id }, orderBy: { seq: "asc" } }),
      this.eligibleTickets(groupId, c.auctionDate),
    ]);
    const tickets = await this.prisma.chitTicket.findMany({ where: { groupId } });
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: tickets.map((t) => t.customerId).filter((x): x is string => !!x) } },
      select: { id: true, firstName: true, lastName: true, code: true },
    });
    const name = new Map(customers.map((x) => [x.id, `${x.firstName} ${x.lastName}`.trim()]));
    const label = (ticketId: string) => {
      const t = tickets.find((x) => x.id === ticketId);
      return t
        ? { ticketId, number: t.number, customerName: (t.customerId && name.get(t.customerId)) || "" }
        : { ticketId, number: 0, customerName: "" };
    };
    const commissionPaise = bpOf(num(g.chitValuePaise), g.commissionBp);
    return {
      group: {
        id: g.id,
        code: g.code,
        name: g.name,
        type: g.type,
        chitValuePaise: num(g.chitValuePaise),
        members: g.members,
        commissionBp: g.commissionBp,
        minBidBp: g.minBidBp,
        maxBidBp: g.maxBidBp,
        status: g.status,
      },
      cycle: toCycleDto(c),
      winner: c.winnerTicketId ? label(c.winnerTicketId) : null,
      limits: {
        minDiscountPaise: Math.max(commissionPaise, bpOf(num(g.chitValuePaise), g.minBidBp)),
        maxDiscountPaise: bpOf(num(g.chitValuePaise), g.maxBidBp),
        commissionPaise,
      },
      bids: bids.map((b) => ({
        id: b.id,
        seq: b.seq,
        ...label(b.ticketId),
        discountPaise: num(b.discountPaise),
        at: b.createdAt,
      })),
      eligible: eligible.map((e) => ({
        ticketId: e.ticket.id,
        number: e.ticket.number,
        customerName: (e.ticket.customerId && name.get(e.ticket.customerId)) || "",
        inArrears: e.inArrears,
      })),
    };
  }

  /** The month being auctioned: the earliest cycle not yet closed. Auctions happen strictly in order. */
  private async assertCurrent(
    groupId: string,
    month: number,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const g = await this.loadGroup(groupId, tx);
    if (g.status !== "RUNNING")
      throw new BadRequestException({ code: "BAD_STATE", message: "The group is not running" });
    const c = await this.cycleOf(groupId, month, tx);
    if (c.status === "CLOSED")
      throw new ConflictException({ code: "ALREADY_CLOSED", message: "This month's auction is already closed" });
    const earlier = await tx.chitCycle.count({ where: { groupId, month: { lt: month }, status: { not: "CLOSED" } } });
    if (earlier) throw new BadRequestException({ code: "OUT_OF_ORDER", message: "Close the earlier months first" });
    return { g, c };
  }

  async recordBid(
    groupId: string,
    month: number,
    input: { ticketId: string; discountPaise: number },
    actor: AuthUser,
    ctx: ReqCtx,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const { g, c } = await this.assertCurrent(groupId, month, tx);
      if (g.type !== "AUCTION")
        throw new BadRequestException({
          code: "NOT_AN_AUCTION",
          message: "This is not an auction chit: nothing to bid on",
        });
      const eligible = (await this.eligibleTickets(groupId, c.auctionDate, tx)).find(
        (e) => e.ticket.id === input.ticketId,
      );
      if (!eligible)
        throw new BadRequestException({
          code: "NOT_ELIGIBLE",
          message: "That ticket has already won, is vacant, or does not belong to this group",
        });
      if (eligible.inArrears)
        throw new BadRequestException({
          code: "IN_ARREARS",
          message: "This member has unpaid earlier installments and cannot bid until they are cleared",
        });

      const value = num(g.chitValuePaise);
      const min = Math.max(bpOf(value, g.commissionBp), bpOf(value, g.minBidBp));
      const max = bpOf(value, g.maxBidBp);
      if (input.discountPaise < min || input.discountPaise > max)
        throw new BadRequestException({
          code: "BID_OUT_OF_RANGE",
          message: `The discount must be between ${min / 100} and ${max / 100} rupees`,
          minPaise: min,
          maxPaise: max,
        });

      await tx.$queryRaw`SELECT id FROM "ChitCycle" WHERE id = ${c.id}::uuid FOR UPDATE`; // keeps bid order (seq) strictly sequential
      const last = await tx.chitBid.aggregate({ where: { cycleId: c.id }, _max: { seq: true } });
      const bid = await tx.chitBid.create({
        data: {
          cycleId: c.id,
          ticketId: input.ticketId,
          discountPaise: BigInt(input.discountPaise),
          seq: (last._max.seq ?? 0) + 1,
          recordedById: actor.id,
        },
      });
      await this.audit.record(
        ctx,
        {
          action: "chit.bid_recorded",
          entity: "ChitCycle",
          entityId: c.id,
          after: { month, ticket: eligible.ticket.number, discountPaise: input.discountPaise, seq: bid.seq },
        },
        tx,
      );
      return { id: bid.id, seq: bid.seq };
    });
  }

  /**
   * Closes the month: picks the winner, calculates everything, fixes each ticket's installment, applies any advance
   * credit, books the foreman's income in the ledger and opens the prize payout. All in one transaction.
   */
  async closeAuction(groupId: string, month: number, note: string | undefined, actor: AuthUser, ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const { g, c } = await this.assertCurrent(groupId, month, tx);
      await tx.$queryRaw`SELECT id FROM "ChitCycle" WHERE id = ${c.id}::uuid FOR UPDATE`;
      if ((await tx.chitCycle.findUniqueOrThrow({ where: { id: c.id } })).status === "CLOSED")
        throw new ConflictException({ code: "ALREADY_CLOSED", message: "This month's auction is already closed" });

      const eligible = (await this.eligibleTickets(groupId, c.auctionDate, tx)).filter((e) => !e.inArrears);
      let winner: (typeof eligible)[number]["ticket"] | undefined;
      let discount: number | null = null;
      let method: string = g.type;
      let tieNote = "";

      if (g.type === "AUCTION") {
        const bids = await tx.chitBid.findMany({
          where: { cycleId: c.id },
          orderBy: [{ discountPaise: "desc" }, { seq: "asc" }],
        });
        if (bids.length === 0)
          throw new BadRequestException({ code: "NO_BIDS", message: "No bids were recorded for this month" });
        const top = bids[0]!;
        const tied = bids.filter((b) => b.discountPaise === top.discountPaise).length;
        if (tied > 1) tieNote = `Tie between ${tied} bids at the same discount; the earliest recorded bid won.`;
        winner = eligible.find((e) => e.ticket.id === top.ticketId)?.ticket;
        if (!winner)
          throw new BadRequestException({ code: "NOT_ELIGIBLE", message: "The highest bidder is no longer eligible" });
        discount = num(top.discountPaise);
      } else if (g.type === "LOTTERY") {
        if (eligible.length === 0)
          throw new BadRequestException({ code: "NO_ELIGIBLE", message: "No eligible ticket for the draw" });
        winner = eligible[randomInt(eligible.length)]!.ticket;
        tieNote = `Drawn at random from ${eligible.length} eligible ticket(s).`;
      } else {
        const next = (
          await tx.chitTicket.findMany({
            where: { groupId, prized: false, customerId: { not: null } },
            orderBy: { payoutOrder: "asc" },
            take: 1,
          })
        )[0];
        winner = next;
        method = "FIXED";
        if (!winner)
          throw new BadRequestException({
            code: "NO_ELIGIBLE",
            message: "Every ticket has already received its prize",
          });
      }

      const b = computeAuction({
        chitValuePaise: num(g.chitValuePaise),
        members: g.members,
        commissionBp: g.commissionBp,
        discountPaise: discount,
      });
      const finalNote = [note, tieNote].filter(Boolean).join(" ") || null;

      await tx.chitCycle.update({
        where: { id: c.id },
        data: {
          status: "CLOSED",
          winnerTicketId: winner.id,
          method,
          discountPaise: BigInt(b.discountPaise),
          commissionPaise: BigInt(b.commissionPaise),
          dividendPerMemberPaise: BigInt(b.dividendPerMemberPaise),
          residuePaise: BigInt(b.residuePaise),
          prizePaise: BigInt(b.prizePaise),
          netInstallmentPaise: BigInt(b.netInstallmentPaise),
          note: finalNote,
          closedAt: new Date(),
          closedById: actor.id,
        },
      });
      await tx.chitTicket.update({ where: { id: winner.id }, data: { prized: true, prizedMonth: month } });

      // Every ticket's installment for the month becomes payable now that the dividend is known.
      await tx.chitInstallment.updateMany({
        where: { cycleId: c.id },
        data: { dividendPaise: BigInt(b.dividendPerMemberPaise), netDuePaise: BigInt(b.netInstallmentPaise) },
      });

      // Advance credit is applied automatically to the newly due installment.
      const withAdvance = await tx.chitTicket.findMany({ where: { groupId, advancePaise: { gt: 0 } } });
      for (const t of withAdvance) {
        const inst = await tx.chitInstallment.findUniqueOrThrow({
          where: { cycleId_ticketId: { cycleId: c.id, ticketId: t.id } },
        });
        const use = Math.min(num(t.advancePaise), b.netInstallmentPaise);
        if (use <= 0) continue;
        await tx.chitInstallment.update({ where: { id: inst.id }, data: { paidPaise: { increment: BigInt(use) } } });
        await tx.chitTicket.update({ where: { id: t.id }, data: { advancePaise: { decrement: BigInt(use) } } });
        await tx.chitPaymentAllocation.create({
          data: { installmentId: inst.id, ticketId: t.id, kind: "ADVANCE_APPLIED", amountPaise: BigInt(use) },
        });
      }

      // Foreman's income (commission plus indivisible paise) leaves the members' pool and becomes income.
      const entry = await this.ledger.post(tx, {
        date: dateStr(c.auctionDate)!,
        memo: `Commission ${g.code} month ${month}`,
        refType: "ChitCycle",
        refId: c.id,
        idempotencyKey: `chit-commission:${c.id}`,
        postedById: actor.id,
        lines: [
          { account: ACCOUNTS.CHIT_PAYABLE, debitPaise: b.foremanIncomePaise, dimension: g.id },
          { account: ACCOUNTS.CHIT_COMMISSION_INCOME, creditPaise: b.foremanIncomePaise, dimension: g.id },
        ],
      });
      await tx.chitCycle.update({ where: { id: c.id }, data: { commissionEntryId: entry.id } });

      const t = await tx.chitTicket.findUniqueOrThrow({ where: { id: winner.id } });
      await tx.chitPayout.create({
        data: {
          cycleId: c.id,
          groupId,
          ticketId: winner.id,
          customerId: t.customerId!,
          prizePaise: BigInt(b.prizePaise),
          netPaise: BigInt(b.prizePaise),
        },
      });

      await this.audit.record(
        ctx,
        {
          action: "chit.auction_closed",
          entity: "ChitCycle",
          entityId: c.id,
          after: { group: g.code, month, ticket: winner.number, method, ...b },
        },
        tx,
      );
      return {
        ...toCycleDto(await tx.chitCycle.findUniqueOrThrow({ where: { id: c.id } })),
        breakdown: b,
        winnerTicketNumber: winner.number,
      };
    });
  }
}
