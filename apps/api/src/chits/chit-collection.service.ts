import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type PayMode } from "@prisma/client";
import { allocatePayment, calcPenalty } from "@jana/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ACCOUNTS, LedgerService } from "../ledger/ledger.service";
import type { AuthUser, ReqCtx } from "../common/decorators";
import { dateStr, num, today } from "./chit.util";

type Tx = Prisma.TransactionClient | PrismaService;

interface InstRow {
  id: string;
  cycleId: string;
  month: number;
  dueDate: string;
  netDuePaise: number;
  paidPaise: number;
  outstandingPaise: number;
  penaltyPaise: number;
}

const cashAccount = (mode: PayMode) => (mode === "CASH" ? ACCOUNTS.CASH : ACCOUNTS.BANK);

@Injectable()
export class ChitCollectionService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private ledger: LedgerService,
  ) {}

  /* ---------------- dues ---------------- */

  /** Installments that are payable (auction closed), with the penalty accrued up to `asOf` and not yet paid. */
  private async installmentsFor(
    tx: Tx,
    ticketId: string,
    group: { penaltyRateBp: number; penaltyGraceDays: number },
    asOf: string,
  ): Promise<InstRow[]> {
    const rows = await tx.chitInstallment.findMany({
      where: { ticketId, netDuePaise: { not: null } },
      include: {
        cycle: { select: { month: true } },
        allocations: { where: { kind: "PENALTY", payment: { status: "POSTED" } }, select: { amountPaise: true } },
      },
      orderBy: { dueDate: "asc" },
    });
    return rows.map((r) => {
      const outstanding = Math.max(0, num(r.netDuePaise) - num(r.paidPaise));
      const accrued = calcPenalty({
        outstandingPaise: outstanding,
        dueDate: dateStr(r.dueDate)!,
        asOf,
        graceDays: group.penaltyGraceDays,
        rateBpPerMonth: group.penaltyRateBp,
      });
      const alreadyPaid = r.allocations.reduce((s, a) => s + num(a.amountPaise), 0);
      return {
        id: r.id,
        cycleId: r.cycleId,
        month: r.cycle.month,
        dueDate: dateStr(r.dueDate)!,
        netDuePaise: num(r.netDuePaise),
        paidPaise: num(r.paidPaise),
        outstandingPaise: outstanding,
        penaltyPaise: Math.max(0, accrued - alreadyPaid),
      };
    });
  }

  async dues(ticketId: string, asOf = today()) {
    const t = await this.prisma.chitTicket.findUnique({ where: { id: ticketId }, include: { group: true } });
    if (!t || t.group.deletedAt) throw new NotFoundException({ code: "NOT_FOUND", message: "Ticket not found" });
    const customer = t.customerId
      ? await this.prisma.customer.findUnique({
          where: { id: t.customerId },
          select: { id: true, code: true, firstName: true, lastName: true, phone: true },
        })
      : null;
    const installments = await this.installmentsFor(this.prisma, ticketId, t.group, asOf);
    const outstandingPaise = installments.reduce((s, i) => s + i.outstandingPaise, 0);
    const penaltyPaise = installments.reduce((s, i) => s + i.penaltyPaise, 0);
    return {
      asOf,
      ticket: { id: t.id, number: t.number, prized: t.prized },
      group: { id: t.group.id, code: t.group.code, name: t.group.name, status: t.group.status },
      customer: customer && {
        id: customer.id,
        code: customer.code,
        name: `${customer.firstName} ${customer.lastName}`.trim(),
        phone: customer.phone,
      },
      installments: installments.filter((i) => i.outstandingPaise > 0 || i.penaltyPaise > 0),
      outstandingPaise,
      penaltyPaise,
      advancePaise: num(t.advancePaise),
      totalPayablePaise: outstandingPaise + penaltyPaise,
    };
  }

  /** One row per ticket for a group: what each member owes today. This is the collector's worklist. */
  async collections(groupId: string, asOf = today()) {
    const g = await this.prisma.chitGroup.findFirst({ where: { id: groupId, deletedAt: null } });
    if (!g) throw new NotFoundException({ code: "NOT_FOUND", message: "Chit group not found" });
    const tickets = await this.prisma.chitTicket.findMany({
      where: { groupId, customerId: { not: null } },
      orderBy: { number: "asc" },
    });
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: tickets.map((t) => t.customerId!) } },
      select: { id: true, code: true, firstName: true, lastName: true, phone: true },
    });
    const who = new Map(customers.map((c) => [c.id, c]));
    const rows = [];
    for (const t of tickets) {
      const inst = await this.installmentsFor(this.prisma, t.id, g, asOf);
      const c = who.get(t.customerId!);
      const overdue = inst.filter((i) => i.outstandingPaise > 0 && i.dueDate < asOf);
      rows.push({
        ticketId: t.id,
        number: t.number,
        customerId: t.customerId,
        customerName: c ? `${c.firstName} ${c.lastName}`.trim() : "",
        phone: c?.phone ?? null,
        outstandingPaise: inst.reduce((s, i) => s + i.outstandingPaise, 0),
        overduePaise: overdue.reduce((s, i) => s + i.outstandingPaise, 0),
        penaltyPaise: inst.reduce((s, i) => s + i.penaltyPaise, 0),
        advancePaise: num(t.advancePaise),
        oldestDueDate: overdue[0]?.dueDate ?? inst.find((i) => i.outstandingPaise > 0)?.dueDate ?? null,
      });
    }
    return {
      asOf,
      rows,
      totals: {
        outstandingPaise: rows.reduce((s, r) => s + r.outstandingPaise, 0),
        overduePaise: rows.reduce((s, r) => s + r.overduePaise, 0),
      },
    };
  }

  /* ---------------- payments ---------------- */

  private async nextReceiptNo(tx: Tx) {
    const seq = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('receipt_seq')`;
    return `RCP${String(seq[0]!.nextval).padStart(6, "0")}`;
  }

  async receive(
    ticketId: string,
    input: { amountPaise: number; mode: PayMode; reference?: string; paidOn?: string },
    key: string | undefined,
    actor: AuthUser,
    ctx: ReqCtx,
  ) {
    if (!key || key.length < 8 || key.length > 80) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Send an Idempotency-Key header (8 to 80 characters) so a retry can never take the same payment twice",
      });
    }
    const replay = await this.replayOf(key, ticketId, input.amountPaise);
    if (replay) return replay;

    const asOfToday = today();
    const paidOn = input.paidOn ?? asOfToday;
    if (paidOn > asOfToday)
      throw new BadRequestException({ code: "FUTURE_DATE", message: "A payment cannot be dated in the future" });
    if (paidOn < asOfToday && !actor.permissions.includes("payment:backdate"))
      throw new ForbiddenException({
        code: "BACKDATE_FORBIDDEN",
        message: "You need the payment:backdate permission to record a payment with an earlier date",
      });

    try {
      const paymentId = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ChitTicket" WHERE id = ${ticketId}::uuid FOR UPDATE`; // one payment at a time per ticket
        const t = await tx.chitTicket.findUnique({ where: { id: ticketId }, include: { group: true } });
        if (!t || t.group.deletedAt) throw new NotFoundException({ code: "NOT_FOUND", message: "Ticket not found" });
        if (!t.customerId) throw new BadRequestException({ code: "VACANT", message: "This ticket has no member" });
        if (t.group.status !== "RUNNING" && t.group.status !== "COMPLETED")
          throw new BadRequestException({
            code: "BAD_STATE",
            message: "Payments can be taken once the group is running",
          });

        const inst = await this.installmentsFor(tx, ticketId, t.group, paidOn);
        const penaltyDue = inst.reduce((s, i) => s + i.penaltyPaise, 0);
        const alloc = allocatePayment(
          input.amountPaise,
          penaltyDue,
          inst
            .filter((i) => i.outstandingPaise > 0)
            .map((i) => ({ id: i.id, dueDate: i.dueDate, outstandingPaise: i.outstandingPaise })),
        );

        const p = await tx.chitPayment.create({
          data: {
            receiptNo: await this.nextReceiptNo(tx),
            groupId: t.groupId,
            ticketId,
            amountPaise: BigInt(input.amountPaise),
            mode: input.mode,
            reference: input.reference,
            paidOn: new Date(`${paidOn}T00:00:00Z`),
            idempotencyKey: key,
            receivedById: actor.id,
          },
        });
        for (const a of alloc.installments) {
          await tx.chitInstallment.update({
            where: { id: a.id },
            data: { paidPaise: { increment: BigInt(a.paidPaise) } },
          });
          await tx.chitPaymentAllocation.create({
            data: {
              paymentId: p.id,
              installmentId: a.id,
              ticketId,
              kind: "INSTALLMENT",
              amountPaise: BigInt(a.paidPaise),
            },
          });
        }
        let penaltyLeft = alloc.penaltyPaise;
        for (const i of inst) {
          if (penaltyLeft <= 0) break;
          const part = Math.min(penaltyLeft, i.penaltyPaise);
          if (part > 0)
            await tx.chitPaymentAllocation.create({
              data: { paymentId: p.id, installmentId: i.id, ticketId, kind: "PENALTY", amountPaise: BigInt(part) },
            });
          penaltyLeft -= part;
        }
        if (alloc.advancePaise > 0) {
          await tx.chitTicket.update({
            where: { id: ticketId },
            data: { advancePaise: { increment: BigInt(alloc.advancePaise) } },
          });
          await tx.chitPaymentAllocation.create({
            data: { paymentId: p.id, ticketId, kind: "ADVANCE", amountPaise: BigInt(alloc.advancePaise) },
          });
        }

        const entry = await this.ledger.post(tx, {
          date: paidOn,
          memo: `Receipt ${p.receiptNo} ${t.group.code} ticket ${t.number}`,
          refType: "ChitPayment",
          refId: p.id,
          idempotencyKey: `chit-payment:${p.id}`,
          postedById: actor.id,
          lines: [
            { account: cashAccount(input.mode), debitPaise: input.amountPaise, dimension: t.groupId },
            {
              account: ACCOUNTS.CHIT_PAYABLE,
              creditPaise: input.amountPaise - alloc.penaltyPaise,
              dimension: t.groupId,
            },
            { account: ACCOUNTS.PENALTY_INCOME, creditPaise: alloc.penaltyPaise, dimension: t.groupId },
          ],
        });
        await tx.chitPayment.update({ where: { id: p.id }, data: { journalEntryId: entry.id } });
        await this.audit.record(
          ctx,
          {
            action: "chit.payment_received",
            entity: "ChitPayment",
            entityId: p.id,
            after: {
              receiptNo: p.receiptNo,
              ticket: t.number,
              amountPaise: input.amountPaise,
              mode: input.mode,
              paidOn,
              penaltyPaise: alloc.penaltyPaise,
              advancePaise: alloc.advancePaise,
            },
          },
          tx,
        );
        return p.id;
      });
      return { ...(await this.receipt(paymentId)), replayed: false };
    } catch (e) {
      // Two identical requests raced: the loser hits the unique key and simply returns the winner's receipt.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.replayOf(key, ticketId, input.amountPaise);
        if (again) return again;
      }
      throw e;
    }
  }

  private async replayOf(key: string, ticketId: string, amountPaise: number) {
    const existing = await this.prisma.chitPayment.findUnique({ where: { idempotencyKey: key } });
    if (!existing) return null;
    if (existing.ticketId !== ticketId || num(existing.amountPaise) !== amountPaise)
      throw new ConflictException({
        code: "IDEMPOTENCY_MISMATCH",
        message: "That Idempotency-Key was already used for a different payment",
      });
    return { ...(await this.receipt(existing.id)), replayed: true };
  }

  async receipt(paymentId: string) {
    const p = await this.prisma.chitPayment.findUnique({
      where: { id: paymentId },
      include: {
        ticket: { include: { group: true } },
        allocations: { include: { installment: { include: { cycle: { select: { month: true } } } } } },
      },
    });
    if (!p) throw new NotFoundException({ code: "NOT_FOUND", message: "Receipt not found" });
    const customer = p.ticket.customerId
      ? await this.prisma.customer.findUnique({
          where: { id: p.ticket.customerId },
          select: { id: true, code: true, firstName: true, lastName: true, phone: true },
        })
      : null;
    return {
      id: p.id,
      receiptNo: p.receiptNo,
      status: p.status,
      paidOn: dateStr(p.paidOn),
      amountPaise: num(p.amountPaise),
      mode: p.mode,
      reference: p.reference,
      reversedAt: p.reversedAt,
      reversalReason: p.reversalReason,
      group: { id: p.ticket.group.id, code: p.ticket.group.code, name: p.ticket.group.name },
      ticket: { id: p.ticketId, number: p.ticket.number },
      customer: customer && {
        id: customer.id,
        code: customer.code,
        name: `${customer.firstName} ${customer.lastName}`.trim(),
        phone: customer.phone,
      },
      allocations: p.allocations.map((a) => ({
        kind: a.kind,
        month: a.installment?.cycle.month ?? null,
        amountPaise: num(a.amountPaise),
      })),
    };
  }

  async listPayments(ticketId: string) {
    const rows = await this.prisma.chitPayment.findMany({ where: { ticketId }, orderBy: { createdAt: "desc" } });
    return rows.map((p) => ({
      id: p.id,
      receiptNo: p.receiptNo,
      paidOn: dateStr(p.paidOn),
      amountPaise: num(p.amountPaise),
      mode: p.mode,
      status: p.status,
    }));
  }

  /**
   * Corrects a mistake by reversing the payment (never by editing it): allocations are unwound and the ledger gets
   * a mirror entry. Blocked if the payment's advance has already been used, since that would leave later months underpaid.
   */
  async reverse(paymentId: string, reason: string, actor: AuthUser, ctx: ReqCtx) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ChitPayment" WHERE id = ${paymentId}::uuid FOR UPDATE`;
      const p = await tx.chitPayment.findUnique({ where: { id: paymentId }, include: { allocations: true } });
      if (!p) throw new NotFoundException({ code: "NOT_FOUND", message: "Payment not found" });
      if (p.status === "REVERSED") return; // already done: idempotent
      if (p.mode === "SET_OFF")
        throw new BadRequestException({
          code: "SET_OFF",
          message: "A set-off against a prize cannot be reversed here",
        });
      await tx.$queryRaw`SELECT id FROM "ChitTicket" WHERE id = ${p.ticketId}::uuid FOR UPDATE`;
      const ticket = await tx.chitTicket.findUniqueOrThrow({ where: { id: p.ticketId } });

      const advance = p.allocations.filter((a) => a.kind === "ADVANCE").reduce((s, a) => s + num(a.amountPaise), 0);
      if (advance > num(ticket.advancePaise)) {
        throw new ConflictException({
          code: "ADVANCE_CONSUMED",
          message:
            "Part of this payment was kept as advance and has already been applied to a later installment. Reverse the later payment first.",
        });
      }
      for (const a of p.allocations.filter((x) => x.kind === "INSTALLMENT")) {
        await tx.chitInstallment.update({
          where: { id: a.installmentId! },
          data: { paidPaise: { decrement: a.amountPaise } },
        });
      }
      if (advance > 0)
        await tx.chitTicket.update({
          where: { id: p.ticketId },
          data: { advancePaise: { decrement: BigInt(advance) } },
        });
      await tx.chitPayment.update({
        where: { id: paymentId },
        data: { status: "REVERSED", reversedAt: new Date(), reversalReason: reason },
      });
      if (p.journalEntryId) await this.ledger.reverse(tx, p.journalEntryId, reason, today(), actor.id);
      await this.audit.record(
        ctx,
        {
          action: "chit.payment_reversed",
          entity: "ChitPayment",
          entityId: paymentId,
          after: { receiptNo: p.receiptNo, amountPaise: num(p.amountPaise), reason },
        },
        tx,
      );
    });
    return this.receipt(paymentId);
  }

  /* ---------------- prize payouts ---------------- */

  async listPayouts(q: { groupId?: string; status?: string }) {
    const rows = await this.prisma.chitPayout.findMany({
      where: { groupId: q.groupId, status: q.status as never },
      orderBy: { createdAt: "desc" },
      include: { cycle: { include: { group: true } } },
    });
    const tickets = await this.prisma.chitTicket.findMany({ where: { id: { in: rows.map((r) => r.ticketId) } } });
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: rows.map((r) => r.customerId) } },
      select: { id: true, firstName: true, lastName: true, code: true },
    });
    return rows.map((r) => {
      const c = customers.find((x) => x.id === r.customerId);
      return {
        id: r.id,
        status: r.status,
        group: { id: r.groupId, code: r.cycle.group.code, name: r.cycle.group.name },
        month: r.cycle.month,
        ticketNumber: tickets.find((t) => t.id === r.ticketId)?.number ?? 0,
        customer: c ? { id: c.id, code: c.code, name: `${c.firstName} ${c.lastName}`.trim() } : null,
        prizePaise: num(r.prizePaise),
        setOffPaise: num(r.setOffPaise),
        netPaise: num(r.netPaise),
        securityVerified: r.securityVerified,
        mode: r.mode,
        reference: r.reference,
        note: r.note,
        approvedAt: r.approvedAt,
        paidAt: r.paidAt,
      };
    });
  }

  /**
   * Approves the payout and settles the winner's own unpaid installments from the prize (set-off). Requires the
   * approver to confirm the security / guarantor check. The cash movement happens in `pay`.
   */
  async approvePayout(
    payoutId: string,
    input: { securityVerified: boolean; note?: string },
    actor: AuthUser,
    ctx: ReqCtx,
  ) {
    if (!input.securityVerified)
      throw new BadRequestException({
        code: "SECURITY_NOT_VERIFIED",
        message: "Confirm that the security / guarantor check is done before approving a payout",
      });
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ChitPayout" WHERE id = ${payoutId}::uuid FOR UPDATE`;
      const po = await tx.chitPayout.findUnique({
        where: { id: payoutId },
        include: { cycle: { include: { group: true } } },
      });
      if (!po) throw new NotFoundException({ code: "NOT_FOUND", message: "Payout not found" });
      if (po.status !== "PENDING")
        throw new BadRequestException({
          code: "BAD_STATE",
          message: `This payout is already ${po.status.toLowerCase()}`,
        });

      await tx.$queryRaw`SELECT id FROM "ChitTicket" WHERE id = ${po.ticketId}::uuid FOR UPDATE`;
      const inst = await this.installmentsFor(tx, po.ticketId, po.cycle.group, today());
      const owed = inst.filter((i) => i.outstandingPaise > 0);
      let room = num(po.prizePaise);
      let setOff = 0;
      if (owed.length) {
        const p = await tx.chitPayment.create({
          data: {
            receiptNo: await this.nextReceiptNo(tx),
            groupId: po.groupId,
            ticketId: po.ticketId,
            amountPaise: 0n,
            mode: "SET_OFF",
            reference: `Set off against prize, month ${po.cycle.month}`,
            paidOn: new Date(`${today()}T00:00:00Z`),
            idempotencyKey: `set-off:${payoutId}`,
            receivedById: actor.id,
          },
        });
        for (const i of owed) {
          const pay = Math.min(room, i.outstandingPaise);
          if (pay <= 0) break;
          await tx.chitInstallment.update({ where: { id: i.id }, data: { paidPaise: { increment: BigInt(pay) } } });
          await tx.chitPaymentAllocation.create({
            data: {
              paymentId: p.id,
              installmentId: i.id,
              ticketId: po.ticketId,
              kind: "INSTALLMENT",
              amountPaise: BigInt(pay),
            },
          });
          room -= pay;
          setOff += pay;
        }
        await tx.chitPayment.update({ where: { id: p.id }, data: { amountPaise: BigInt(setOff) } });
      }
      await tx.chitPayout.update({
        where: { id: payoutId },
        data: {
          status: "APPROVED",
          securityVerified: true,
          setOffPaise: BigInt(setOff),
          netPaise: BigInt(num(po.prizePaise) - setOff),
          approvedById: actor.id,
          approvedAt: new Date(),
          note: input.note,
        },
      });
      await this.audit.record(
        ctx,
        {
          action: "chit.payout_approved",
          entity: "ChitPayout",
          entityId: payoutId,
          after: {
            prizePaise: num(po.prizePaise),
            setOffPaise: setOff,
            netPaise: num(po.prizePaise) - setOff,
            securityVerified: true,
          },
        },
        tx,
      );
    });
    return (await this.listPayouts({})).find((p) => p.id === payoutId)!;
  }

  async payPayout(
    payoutId: string,
    input: { mode: PayMode; reference?: string; note?: string },
    actor: AuthUser,
    ctx: ReqCtx,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ChitPayout" WHERE id = ${payoutId}::uuid FOR UPDATE`;
      const po = await tx.chitPayout.findUnique({
        where: { id: payoutId },
        include: { cycle: { include: { group: true } } },
      });
      if (!po) throw new NotFoundException({ code: "NOT_FOUND", message: "Payout not found" });
      if (po.status !== "APPROVED")
        throw new BadRequestException({
          code: "BAD_STATE",
          message: po.status === "PAID" ? "This payout has already been paid" : "Approve the payout before paying it",
        });
      const net = num(po.netPaise);
      let entryId: string | undefined;
      if (net > 0) {
        const e = await this.ledger.post(tx, {
          date: today(),
          memo: `Prize payout ${po.cycle.group.code} month ${po.cycle.month}`,
          refType: "ChitPayout",
          refId: payoutId,
          idempotencyKey: `chit-payout:${payoutId}`,
          postedById: actor.id,
          lines: [
            { account: ACCOUNTS.CHIT_PAYABLE, debitPaise: net, dimension: po.groupId },
            { account: cashAccount(input.mode), creditPaise: net, dimension: po.groupId },
          ],
        });
        entryId = e.id;
      }
      await tx.chitPayout.update({
        where: { id: payoutId },
        data: {
          status: "PAID",
          paidById: actor.id,
          paidAt: new Date(),
          mode: input.mode,
          reference: input.reference,
          note: input.note ?? po.note,
          journalEntryId: entryId,
        },
      });
      await this.audit.record(
        ctx,
        {
          action: "chit.payout_paid",
          entity: "ChitPayout",
          entityId: payoutId,
          after: { netPaise: net, mode: input.mode, reference: input.reference },
        },
        tx,
      );
    });
    return (await this.listPayouts({})).find((p) => p.id === payoutId)!;
  }

  /* ---------------- passbook and statement ---------------- */

  async passbook(ticketId: string) {
    const t = await this.prisma.chitTicket.findUnique({ where: { id: ticketId }, include: { group: true } });
    if (!t || t.group.deletedAt) throw new NotFoundException({ code: "NOT_FOUND", message: "Ticket not found" });
    const [rows, payments, payout, customer] = await Promise.all([
      this.prisma.chitInstallment.findMany({
        where: { ticketId },
        include: { cycle: true },
        orderBy: { cycle: { month: "asc" } },
      }),
      this.listPayments(ticketId),
      this.prisma.chitPayout.findFirst({ where: { ticketId }, include: { cycle: { select: { month: true } } } }),
      t.customerId
        ? this.prisma.customer.findUnique({
            where: { id: t.customerId },
            select: { id: true, code: true, firstName: true, lastName: true },
          })
        : null,
    ]);
    const now = today();
    const months = rows.map((r) => {
      const netDue = r.netDuePaise === null ? null : num(r.netDuePaise);
      const outstanding = netDue === null ? null : Math.max(0, netDue - num(r.paidPaise));
      const status =
        netDue === null
          ? "UPCOMING"
          : outstanding === 0
            ? "PAID"
            : dateStr(r.dueDate)! < now
              ? "OVERDUE"
              : num(r.paidPaise) > 0
                ? "PARTIAL"
                : "DUE";
      return {
        month: r.cycle.month,
        auctionDate: dateStr(r.cycle.auctionDate),
        dueDate: dateStr(r.dueDate),
        basePaise: num(r.basePaise),
        dividendPaise: num(r.dividendPaise),
        netDuePaise: netDue,
        paidPaise: num(r.paidPaise),
        outstandingPaise: outstanding,
        status,
        won: r.cycle.winnerTicketId === ticketId,
      };
    });
    return {
      ticket: { id: t.id, number: t.number, prized: t.prized, prizedMonth: t.prizedMonth },
      group: {
        id: t.group.id,
        code: t.group.code,
        name: t.group.name,
        status: t.group.status,
        chitValuePaise: num(t.group.chitValuePaise),
      },
      customer: customer && {
        id: customer.id,
        code: customer.code,
        name: `${customer.firstName} ${customer.lastName}`.trim(),
      },
      months,
      prize: payout && {
        month: payout.cycle.month,
        status: payout.status,
        prizePaise: num(payout.prizePaise),
        setOffPaise: num(payout.setOffPaise),
        netPaise: num(payout.netPaise),
      },
      payments,
      totals: {
        paidPaise: payments
          .filter((p) => p.status === "POSTED" && p.mode !== "SET_OFF")
          .reduce((s, p) => s + p.amountPaise, 0),
        dividendsReceivedPaise: months.filter((m) => m.netDuePaise !== null).reduce((s, m) => s + m.dividendPaise, 0),
        outstandingPaise: months.reduce((s, m) => s + (m.outstandingPaise ?? 0), 0),
        advancePaise: num(t.advancePaise),
      },
    };
  }

  /** Month-by-month statement of a group, cross-checked against the ledger's pool balance. */
  async statement(groupId: string) {
    const g = await this.prisma.chitGroup.findFirst({ where: { id: groupId, deletedAt: null } });
    if (!g) throw new NotFoundException({ code: "NOT_FOUND", message: "Chit group not found" });
    const cycles = await this.prisma.chitCycle.findMany({
      where: { groupId },
      orderBy: { month: "asc" },
      include: { installments: { select: { netDuePaise: true, paidPaise: true } }, payout: true },
    });
    const tickets = await this.prisma.chitTicket.findMany({ where: { groupId } });
    const months = cycles.map((c) => {
      const due = c.installments.reduce((s, i) => s + num(i.netDuePaise), 0);
      const collected = c.installments.reduce((s, i) => s + num(i.paidPaise), 0);
      return {
        month: c.month,
        auctionDate: dateStr(c.auctionDate),
        status: c.status,
        winnerTicket: tickets.find((t) => t.id === c.winnerTicketId)?.number ?? null,
        discountPaise: c.discountPaise === null ? null : num(c.discountPaise),
        commissionPaise: c.commissionPaise === null ? null : num(c.commissionPaise),
        dividendPerMemberPaise: c.dividendPerMemberPaise === null ? null : num(c.dividendPerMemberPaise),
        prizePaise: c.prizePaise === null ? null : num(c.prizePaise),
        payoutStatus: c.payout?.status ?? null,
        dueTotalPaise: due,
        collectedPaise: collected,
        outstandingPaise: Math.max(0, due - collected),
      };
    });
    const poolBalancePaise = -(await this.ledger.balance(ACCOUNTS.CHIT_PAYABLE, groupId));
    return {
      group: { id: g.id, code: g.code, name: g.name, status: g.status },
      months,
      totals: {
        dueTotalPaise: months.reduce((s, m) => s + m.dueTotalPaise, 0),
        collectedPaise: months.reduce((s, m) => s + m.collectedPaise, 0),
        outstandingPaise: months.reduce((s, m) => s + m.outstandingPaise, 0),
      },
      poolBalancePaise,
    };
  }
}
