import type { Prisma } from "@prisma/client";
import { loanPosition, type LoanPosition, type PrincipalChange } from "@jana/shared";
import type { PrismaService } from "../prisma/prisma.service";
import { dateStr, num } from "../chits/chit.util";

export { dateStr, num, today } from "../chits/chit.util";
export type Tx = Prisma.TransactionClient | PrismaService;

/** What has happened to a loan since it was disbursed: the only inputs, besides its terms, to every figure. */
export interface LoanHistory {
  changes: PrincipalChange[];
  paidByCycle: Record<number, number>;
  lastPaidOn: string | null;
}

/** Reads the history of many loans in two queries. Reversed payments are ignored everywhere. */
export async function loadHistories(db: Tx, loanIds: string[]): Promise<Map<string, LoanHistory>> {
  const out = new Map<string, LoanHistory>(
    loanIds.map((id) => [id, { changes: [], paidByCycle: {}, lastPaidOn: null }]),
  );
  if (!loanIds.length) return out;
  const [payments, allocations] = await Promise.all([
    db.loanPayment.findMany({
      where: { loanId: { in: loanIds }, status: "POSTED" },
      select: { loanId: true, paidOn: true, principalPaise: true },
    }),
    db.loanInterestAllocation.findMany({
      where: { loanId: { in: loanIds }, payment: { status: "POSTED" } },
      select: { loanId: true, cycleSeq: true, amountPaise: true },
    }),
  ]);
  for (const p of payments) {
    const h = out.get(p.loanId)!;
    const date = dateStr(p.paidOn)!;
    if (num(p.principalPaise) > 0) h.changes.push({ date, deltaPaise: -num(p.principalPaise) });
    if (!h.lastPaidOn || date > h.lastPaidOn) h.lastPaidOn = date;
  }
  for (const a of allocations) {
    const h = out.get(a.loanId)!;
    h.paidByCycle[a.cycleSeq] = (h.paidByCycle[a.cycleSeq] ?? 0) + num(a.amountPaise);
  }
  return out;
}

interface Terms {
  status: string;
  principalPaise: bigint;
  monthlyRateBp: number;
  disbursedOn: Date | null;
  closedOn: Date | null;
}

/** Null until the loan is disbursed. A closed loan is looked at as of the day it closed, so it never keeps accruing. */
export function positionFor(loan: Terms, history: LoanHistory, asOf: string): LoanPosition | null {
  if (!loan.disbursedOn || (loan.status !== "ACTIVE" && loan.status !== "CLOSED")) return null;
  const closedOn = dateStr(loan.closedOn);
  const at = loan.status === "CLOSED" && closedOn && closedOn < asOf ? closedOn : asOf;
  return loanPosition({
    principalPaise: num(loan.principalPaise),
    monthlyRateBp: loan.monthlyRateBp,
    startDate: dateStr(loan.disbursedOn)!,
    changes: history.changes,
    paidByCycle: history.paidByCycle,
    asOf: at,
  });
}

export const personName = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`.trim();

export const customerBrief = { id: true, code: true, firstName: true, lastName: true, phone: true } as const;
