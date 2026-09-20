import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type PayMode } from "@prisma/client";
import { allocateInterest, cycleBounds, type LoanPaymentInput } from "@jana/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ACCOUNTS, LedgerService } from "../ledger/ledger.service";
import type { AuthUser, ReqCtx } from "../common/decorators";
import { customerBrief, dateStr, loadHistories, num, personName, positionFor, today } from "./loan.util";

const cashAccount = (mode: PayMode) => (mode === "CASH" ? ACCOUNTS.CASH : ACCOUNTS.BANK);
const rs = (paise: number) => `Rs ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

@Injectable()
export class LoanPaymentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private ledger: LedgerService,
  ) {}

  /** What it takes to close the loan on a date: the outstanding principal plus every rupee of interest earned so far. */
  async payoff(loanId: string, asOf = today()) {
    const loan = await this.prisma.loan.findUnique({ where: { id: loanId } });
    if (!loan) throw new NotFoundException({ code: "NOT_FOUND", message: "Loan not found" });
    if (loan.status !== "ACTIVE")
      throw new ConflictException({ code: "BAD_STATE", message: "Only an active loan has a payoff figure" });
    const hist = (await loadHistories(this.prisma, [loanId])).get(loanId)!;
    const pos = positionFor(loan, hist, asOf)!;
    return {
      asOf,
      principalPaise: pos.principalOutstandingPaise,
      interestPaise: pos.interestPayablePaise,
      totalPaise: pos.payoffPaise,
      cycles: pos.cycles.filter((c) => c.outstandingPaise > 0),
    };
  }

  private async nextReceiptNo(tx: Prisma.TransactionClient) {
    const seq = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('receipt_seq')`;
    return `RCP${String(seq[0]!.nextval).padStart(6, "0")}`;
  }

  private sameRequest(
    existing: { loanId: string; interestPaise: bigint; principalPaise: bigint },
    loanId: string,
    i: LoanPaymentInput,
  ) {
    return (
      existing.loanId === loanId &&
      num(existing.interestPaise) === i.interestPaise &&
      num(existing.principalPaise) === i.principalPaise
    );
  }

  private async replayOf(key: string, loanId: string, input: LoanPaymentInput) {
    const existing = await this.prisma.loanPayment.findUnique({ where: { idempotencyKey: key } });
    if (!existing) return null;
    if (!this.sameRequest(existing, loanId, input))
      throw new ConflictException({
        code: "IDEMPOTENCY_MISMATCH",
        message: "That Idempotency-Key was already used for a different payment",
      });
    return { ...(await this.receipt(existing.id)), replayed: true };
  }

  async receive(loanId: string, input: LoanPaymentInput, key: string | undefined, actor: AuthUser, ctx: ReqCtx) {
    if (!key || key.length < 8 || key.length > 80)
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Send an Idempotency-Key header (8 to 80 characters) so a retry can never take the same payment twice",
      });
    const replay = await this.replayOf(key, loanId, input);
    if (replay) return replay;

    const t = today();
    const paidOn = input.paidOn ?? t;
    if (paidOn > t)
      throw new BadRequestException({ code: "FUTURE_DATE", message: "A payment cannot be dated in the future" });
    if (paidOn < t && !actor.permissions.includes("payment:backdate"))
      throw new ForbiddenException({
        code: "BACKDATE_FORBIDDEN",
        message: "You need the payment:backdate permission to record a payment with an earlier date",
      });

    try {
      const done = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Loan" WHERE id = ${loanId}::uuid FOR UPDATE`; // one payment at a time per loan
        // A retry that queued behind the request it repeats must get that request's receipt, not a complaint that the
        // interest it tried to pay is already paid. So the key is checked again now that we hold the lock.
        const dup = await tx.loanPayment.findUnique({ where: { idempotencyKey: key } });
        if (dup) {
          if (!this.sameRequest(dup, loanId, input))
            throw new ConflictException({
              code: "IDEMPOTENCY_MISMATCH",
              message: "That Idempotency-Key was already used for a different payment",
            });
          return { id: dup.id, replayed: true };
        }
        const loan = await tx.loan.findUnique({ where: { id: loanId } });
        if (!loan) throw new NotFoundException({ code: "NOT_FOUND", message: "Loan not found" });
        if (loan.status !== "ACTIVE")
          throw new ConflictException({ code: "BAD_STATE", message: "Payments can be taken on an active loan only" });
        const hist = (await loadHistories(tx, [loanId])).get(loanId)!;
        if (paidOn < dateStr(loan.disbursedOn)!)
          throw new BadRequestException({
            code: "BEFORE_DISBURSAL",
            message: "A payment cannot be dated before the loan was disbursed",
          });
        // Interest is worked out from the payment history, so history must only ever grow at the end. That is what
        // makes every past figure, and every receipt already printed, stay true.
        if (hist.lastPaidOn && paidOn < hist.lastPaidOn)
          throw new ConflictException({
            code: "OUT_OF_ORDER",
            message: `A payment dated ${hist.lastPaidOn} already exists, so this one cannot be dated earlier`,
          });
        const pos = positionFor(loan, hist, paidOn)!;
        if (input.interestPaise > pos.interestPayablePaise)
          throw new BadRequestException({
            code: "INTEREST_TOO_HIGH",
            message: `Only ${rs(pos.interestPayablePaise)} of interest is payable on ${paidOn}. Use the principal amount for anything above that.`,
          });
        if (input.principalPaise > pos.principalOutstandingPaise)
          throw new BadRequestException({
            code: "PRINCIPAL_TOO_HIGH",
            message: `Only ${rs(pos.principalOutstandingPaise)} of principal is outstanding`,
          });

        const total = input.interestPaise + input.principalPaise;
        const p = await tx.loanPayment.create({
          data: {
            receiptNo: await this.nextReceiptNo(tx),
            loanId,
            amountPaise: BigInt(total),
            interestPaise: BigInt(input.interestPaise),
            principalPaise: BigInt(input.principalPaise),
            mode: input.mode as PayMode,
            reference: input.reference,
            paidOn: new Date(`${paidOn}T00:00:00Z`),
            idempotencyKey: key,
            receivedById: actor.id,
          },
        });
        for (const a of allocateInterest(input.interestPaise, pos.cycles)) {
          await tx.loanInterestAllocation.create({
            data: { paymentId: p.id, loanId, cycleSeq: a.seq, amountPaise: BigInt(a.amountPaise) },
          });
        }
        const entry = await this.ledger.post(tx, {
          date: paidOn,
          memo: `Receipt ${p.receiptNo} loan ${loan.code}`,
          refType: "LoanPayment",
          refId: p.id,
          idempotencyKey: `loan-payment:${p.id}`,
          postedById: actor.id,
          lines: [
            { account: cashAccount(input.mode as PayMode), debitPaise: total, dimension: loanId },
            { account: ACCOUNTS.LOANS_RECEIVABLE, creditPaise: input.principalPaise, dimension: loanId },
            { account: ACCOUNTS.INTEREST_INCOME, creditPaise: input.interestPaise, dimension: loanId },
          ],
        });
        await tx.loanPayment.update({ where: { id: p.id }, data: { journalEntryId: entry.id } });

        const closes =
          pos.principalOutstandingPaise - input.principalPaise === 0 &&
          pos.interestPayablePaise - input.interestPaise === 0;
        if (closes)
          await tx.loan.update({
            where: { id: loanId },
            data: { status: "CLOSED", closedOn: new Date(`${paidOn}T00:00:00Z`) },
          });
        await this.audit.record(
          ctx,
          {
            action: "loan.payment_received",
            entity: "LoanPayment",
            entityId: p.id,
            after: {
              receiptNo: p.receiptNo,
              loan: loan.code,
              interestPaise: input.interestPaise,
              principalPaise: input.principalPaise,
              mode: input.mode,
              paidOn,
            },
          },
          tx,
        );
        if (closes)
          await this.audit.record(
            ctx,
            { action: "loan.closed", entity: "Loan", entityId: loanId, after: { code: loan.code, closedOn: paidOn } },
            tx,
          );
        return { id: p.id, replayed: false };
      });
      return { ...(await this.receipt(done.id)), replayed: done.replayed };
    } catch (e) {
      // Two identical requests raced: the loser hits the unique key and simply returns the winner's receipt.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.replayOf(key, loanId, input);
        if (again) return again;
      }
      throw e;
    }
  }

  async receipt(paymentId: string) {
    const p = await this.prisma.loanPayment.findUnique({
      where: { id: paymentId },
      include: { loan: true, allocations: { orderBy: { cycleSeq: "asc" } } },
    });
    if (!p) throw new NotFoundException({ code: "NOT_FOUND", message: "Receipt not found" });
    const customer = await this.prisma.customer.findUnique({ where: { id: p.loan.customerId }, select: customerBrief });
    // Principal still outstanding straight after this payment: payments are only ever added at the end of the history.
    const earlier = await this.prisma.loanPayment.aggregate({
      where: {
        loanId: p.loanId,
        status: "POSTED",
        OR: [{ paidOn: { lt: p.paidOn } }, { paidOn: p.paidOn, createdAt: { lte: p.createdAt } }],
      },
      _sum: { principalPaise: true },
    });
    const start = dateStr(p.loan.disbursedOn);
    return {
      id: p.id,
      receiptNo: p.receiptNo,
      status: p.status,
      paidOn: dateStr(p.paidOn),
      amountPaise: num(p.amountPaise),
      interestPaise: num(p.interestPaise),
      principalPaise: num(p.principalPaise),
      mode: p.mode,
      reference: p.reference,
      reversedAt: p.reversedAt,
      reversalReason: p.reversalReason,
      loan: { id: p.loan.id, code: p.loan.code, status: p.loan.status, monthlyRateBp: p.loan.monthlyRateBp },
      customer: customer && { id: customer.id, code: customer.code, name: personName(customer), phone: customer.phone },
      interestFor: p.allocations.map((a) => ({
        month: a.cycleSeq,
        dueDate: start ? cycleBounds(start, a.cycleSeq).end : null,
        amountPaise: num(a.amountPaise),
      })),
      principalOutstandingAfterPaise:
        p.status === "POSTED" ? Math.max(0, num(p.loan.principalPaise) - num(earlier._sum.principalPaise)) : null,
    };
  }

  /**
   * Corrects a mistake by reversing the payment, never by editing it. Only the latest payment on a loan can be
   * reversed: later payments were valued on the strength of this one, so they have to be undone first.
   */
  async reverse(paymentId: string, reason: string, actor: AuthUser, ctx: ReqCtx) {
    const found = await this.prisma.loanPayment.findUnique({ where: { id: paymentId }, select: { loanId: true } });
    if (!found) throw new NotFoundException({ code: "NOT_FOUND", message: "Payment not found" });
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Loan" WHERE id = ${found.loanId}::uuid FOR UPDATE`;
      const p = await tx.loanPayment.findUniqueOrThrow({ where: { id: paymentId }, include: { loan: true } });
      if (p.status === "REVERSED") return; // already done: idempotent
      const later = await tx.loanPayment.findFirst({
        where: {
          loanId: p.loanId,
          status: "POSTED",
          id: { not: p.id },
          OR: [{ paidOn: { gt: p.paidOn } }, { paidOn: p.paidOn, createdAt: { gt: p.createdAt } }],
        },
        select: { receiptNo: true },
      });
      if (later)
        throw new ConflictException({
          code: "NOT_LATEST",
          message: `Reverse the later receipt ${later.receiptNo} first`,
        });
      await tx.loanPayment.update({
        where: { id: p.id },
        data: { status: "REVERSED", reversedAt: new Date(), reversalReason: reason },
      });
      if (p.journalEntryId) await this.ledger.reverse(tx, p.journalEntryId, reason, today(), actor.id);
      if (p.loan.status === "CLOSED")
        await tx.loan.update({ where: { id: p.loanId }, data: { status: "ACTIVE", closedOn: null } });
      await this.audit.record(
        ctx,
        {
          action: "loan.payment_reversed",
          entity: "LoanPayment",
          entityId: paymentId,
          after: { receiptNo: p.receiptNo, loan: p.loan.code, amountPaise: num(p.amountPaise), reason },
        },
        tx,
      );
    });
    return this.receipt(paymentId);
  }
}
