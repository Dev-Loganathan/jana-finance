import { BadRequestException, ConflictException, Global, Injectable, Module, NotFoundException } from "@nestjs/common";
import { Prisma, type AccountType, type JournalEntry } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { PrismaService } from "../prisma/prisma.service";

type Tx = Prisma.TransactionClient | PrismaService;

/** Minimal default chart of accounts. Codes are stable: other modules post by code. */
export const ACCOUNTS = {
  CASH: "1000",
  BANK: "1100",
  CHIT_PAYABLE: "2000",
  CAPITAL: "3000",
  CHIT_COMMISSION_INCOME: "4000",
  PENALTY_INCOME: "4100",
  FEE_INCOME: "4200",
  EXPENSES: "5000",
} as const;

const DEFAULT_CHART: { code: string; name: string; type: AccountType }[] = [
  { code: "1000", name: "Cash in hand", type: "ASSET" },
  { code: "1100", name: "Bank", type: "ASSET" },
  { code: "2000", name: "Chit subscribers' payable", type: "LIABILITY" },
  { code: "3000", name: "Owner's capital", type: "EQUITY" },
  { code: "4000", name: "Chit commission income", type: "INCOME" },
  { code: "4100", name: "Penalty income", type: "INCOME" },
  { code: "4200", name: "Fee income", type: "INCOME" },
  { code: "5000", name: "Operating expenses", type: "EXPENSE" },
];

export interface PostLine {
  account: string;
  debitPaise?: number;
  creditPaise?: number;
  dimension?: string;
}

export interface PostInput {
  date: string;
  memo: string;
  lines: PostLine[];
  refType?: string;
  refId?: string;
  /** Same key = same posting. Retries and double clicks return the original entry instead of posting again. */
  idempotencyKey: string;
  postedById?: string;
}

/**
 * The ONLY code path that writes to the ledger. Entries must balance, are immutable (also enforced by database
 * triggers), and corrections are made by reversal entries, never by editing.
 */
@Injectable()
export class LedgerService {
  constructor(private prisma: PrismaService) {}

  private async accountIds(tx: Tx, codes: string[]): Promise<Map<string, string>> {
    const found = await tx.account.findMany({ where: { code: { in: codes } } });
    const map = new Map(found.map((a) => [a.code, a.id]));
    for (const code of codes) {
      if (map.has(code)) continue;
      const def = DEFAULT_CHART.find((a) => a.code === code);
      if (!def) throw new BadRequestException({ code: "UNKNOWN_ACCOUNT", message: `Unknown ledger account ${code}` });
      const a = await tx.account.upsert({ where: { code }, create: { ...def, system: true }, update: {} });
      map.set(code, a.id);
    }
    return map;
  }

  async post(tx: Tx, input: PostInput): Promise<JournalEntry> {
    try {
      return await this.postOnce(tx, input);
    } catch (e) {
      // Two identical requests raced. Outside a transaction the loser can safely fetch the winner's entry.
      // (Inside a transaction Postgres aborts it, so callers there rely on their own unique key.)
      if (tx instanceof PrismaService && e instanceof PrismaClientKnownRequestError && e.code === "P2002") {
        const winner = await tx.journalEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (winner) return winner;
      }
      throw e;
    }
  }

  private async postOnce(tx: Tx, input: PostInput): Promise<JournalEntry> {
    const existing = await tx.journalEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;

    const lines = input.lines.filter((l) => (l.debitPaise ?? 0) > 0 || (l.creditPaise ?? 0) > 0);
    if (lines.length < 2)
      throw new BadRequestException({ code: "UNBALANCED", message: "A journal entry needs at least two lines" });
    let debit = 0;
    let credit = 0;
    for (const l of lines) {
      const d = l.debitPaise ?? 0;
      const c = l.creditPaise ?? 0;
      if (!Number.isSafeInteger(d) || !Number.isSafeInteger(c) || d < 0 || c < 0 || (d > 0 && c > 0)) {
        throw new BadRequestException({
          code: "BAD_LINE",
          message: "Each line must be a single-sided, non-negative whole number of paise",
        });
      }
      debit += d;
      credit += c;
    }
    if (debit !== credit)
      throw new BadRequestException({
        code: "UNBALANCED",
        message: `Entry does not balance (debits ${debit}, credits ${credit})`,
      });

    const ids = await this.accountIds(tx, [...new Set(lines.map((l) => l.account))]);
    const seq = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('journal_seq')`;
    return tx.journalEntry.create({
      data: {
        number: `JV${String(seq[0]!.nextval).padStart(6, "0")}`,
        entryDate: new Date(`${input.date}T00:00:00Z`),
        memo: input.memo,
        refType: input.refType,
        refId: input.refId,
        idempotencyKey: input.idempotencyKey,
        postedById: input.postedById,
        lines: {
          create: lines.map((l) => ({
            accountId: ids.get(l.account)!,
            debitPaise: BigInt(l.debitPaise ?? 0),
            creditPaise: BigInt(l.creditPaise ?? 0),
            dimension: l.dimension,
          })),
        },
      },
    });
  }

  /** Posts the mirror image of an entry. Safe to call twice: the second call returns the first reversal. */
  async reverse(tx: Tx, entryId: string, memo: string, date: string, postedById?: string): Promise<JournalEntry> {
    const original = await tx.journalEntry.findUnique({
      where: { id: entryId },
      include: { lines: { include: { account: true } } },
    });
    if (!original) throw new NotFoundException({ code: "NOT_FOUND", message: "Journal entry not found" });
    const already = await tx.journalEntry.findUnique({ where: { reversesId: entryId } });
    if (already) return already;
    if (original.reversesId)
      throw new ConflictException({ code: "IS_REVERSAL", message: "A reversal cannot itself be reversed" });

    const seq = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('journal_seq')`;
    return tx.journalEntry.create({
      data: {
        number: `JV${String(seq[0]!.nextval).padStart(6, "0")}`,
        entryDate: new Date(`${date}T00:00:00Z`),
        memo: `Reversal of ${original.number}: ${memo}`,
        refType: original.refType,
        refId: original.refId,
        idempotencyKey: `reversal:${entryId}`,
        reversesId: entryId,
        postedById,
        lines: {
          create: original.lines.map((l) => ({
            accountId: l.accountId,
            debitPaise: l.creditPaise,
            creditPaise: l.debitPaise,
            dimension: l.dimension,
          })),
        },
      },
    });
  }

  async trialBalance(asOf?: string) {
    const rows = await this.prisma.journalLine.groupBy({
      by: ["accountId"],
      _sum: { debitPaise: true, creditPaise: true },
      where: asOf ? { entry: { entryDate: { lte: new Date(`${asOf}T00:00:00Z`) } } } : undefined,
    });
    const accounts = await this.prisma.account.findMany({ orderBy: { code: "asc" } });
    const sums = new Map(rows.map((r) => [r.accountId, r._sum]));
    const lines = accounts.map((a) => {
      const s = sums.get(a.id);
      return {
        code: a.code,
        name: a.name,
        type: a.type,
        debitPaise: Number(s?.debitPaise ?? 0n),
        creditPaise: Number(s?.creditPaise ?? 0n),
      };
    });
    const totals = {
      debitPaise: lines.reduce((t, l) => t + l.debitPaise, 0),
      creditPaise: lines.reduce((t, l) => t + l.creditPaise, 0),
    };
    return {
      lines: lines.filter((l) => l.debitPaise || l.creditPaise),
      totals,
      balanced: totals.debitPaise === totals.creditPaise,
    };
  }

  /** Balance of one account (debits minus credits), optionally limited to a dimension such as a chit group. */
  async balance(code: string, dimension?: string): Promise<number> {
    const a = await this.prisma.account.findUnique({ where: { code } });
    if (!a) return 0;
    const s = await this.prisma.journalLine.aggregate({
      _sum: { debitPaise: true, creditPaise: true },
      where: { accountId: a.id, dimension },
    });
    return Number(s._sum.debitPaise ?? 0n) - Number(s._sum.creditPaise ?? 0n);
  }

  async listEntries(q: { page: number; pageSize: number; refType?: string; refId?: string }) {
    const where = { refType: q.refType, refId: q.refId };
    const [rows, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { lines: { include: { account: { select: { code: true, name: true } } } } },
      }),
      this.prisma.journalEntry.count({ where }),
    ]);
    return {
      items: rows.map((e) => ({
        id: e.id,
        number: e.number,
        date: e.entryDate.toISOString().slice(0, 10),
        memo: e.memo,
        refType: e.refType,
        refId: e.refId,
        reverses: e.reversesId,
        lines: e.lines.map((l) => ({
          account: `${l.account.code} ${l.account.name}`,
          debitPaise: Number(l.debitPaise),
          creditPaise: Number(l.creditPaise),
          dimension: l.dimension,
        })),
      })),
      page: q.page,
      pageSize: q.pageSize,
      total,
    };
  }
}

@Global()
@Module({ providers: [LedgerService], exports: [LedgerService] })
export class LedgerModule {}
