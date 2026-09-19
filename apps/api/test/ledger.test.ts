import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { ACCOUNTS, LedgerService } from "../src/ledger/ledger.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { ensureRoles, makeApp, makeUser, prisma, token, uniq } from "./helpers";

describe("ledger", () => {
  let app: INestApplication;
  let ledger: LedgerService;
  let db: PrismaService;

  beforeAll(async () => {
    app = await makeApp();
    await ensureRoles();
    ledger = app.get(LedgerService);
    db = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const post = (key: string, amount = 100_00) =>
    ledger.post(db, {
      date: "2026-10-01",
      memo: "test",
      idempotencyKey: key,
      lines: [
        { account: ACCOUNTS.CASH, debitPaise: amount },
        { account: ACCOUNTS.CHIT_PAYABLE, creditPaise: amount },
      ],
    });

  it("posts a balanced entry with a sequential number, creating default accounts on demand", async () => {
    const e = await post(uniq("k"));
    expect(e.number).toMatch(/^JV\d{6}$/);
    const lines = await prisma.journalLine.findMany({ where: { entryId: e.id }, include: { account: true } });
    expect(lines.map((l) => l.account.code).sort()).toEqual(["1000", "2000"]);
  });

  it("is idempotent: the same key never posts twice", async () => {
    const key = uniq("idem");
    const [a, b] = await Promise.all([post(key), post(key)]);
    const again = await post(key);
    expect(again.id).toBe(a.id);
    expect(b.id).toBe(a.id);
    expect(await prisma.journalEntry.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it("rejects unbalanced, one-line, two-sided and fractional entries before touching the database", async () => {
    const bad = (lines: never[]) =>
      ledger.post(db, { date: "2026-10-01", memo: "x", idempotencyKey: uniq("bad"), lines });
    await expect(
      bad([
        { account: "1000", debitPaise: 100 },
        { account: "2000", creditPaise: 90 },
      ] as never),
    ).rejects.toMatchObject({ response: { code: "UNBALANCED" } });
    await expect(bad([{ account: "1000", debitPaise: 100 }] as never)).rejects.toMatchObject({
      response: { code: "UNBALANCED" },
    });
    await expect(
      bad([
        { account: "1000", debitPaise: 100, creditPaise: 100 },
        { account: "2000", creditPaise: 5 },
      ] as never),
    ).rejects.toMatchObject({ response: { code: "BAD_LINE" } });
    await expect(
      bad([
        { account: "1000", debitPaise: 10.5 },
        { account: "2000", creditPaise: 10.5 },
      ] as never),
    ).rejects.toMatchObject({ response: { code: "BAD_LINE" } });
    await expect(
      bad([
        { account: "9999", debitPaise: 1 },
        { account: "2000", creditPaise: 1 },
      ] as never),
    ).rejects.toMatchObject({ response: { code: "UNKNOWN_ACCOUNT" } });
  });

  it("the database itself refuses an unbalanced entry, and any edit or delete", async () => {
    const acct = await prisma.account.findFirstOrThrow({ where: { code: "1000" } });
    // Bypass the service on purpose: an unbalanced entry must fail at commit.
    await expect(
      prisma.journalEntry.create({
        data: {
          number: uniq("RAW"),
          entryDate: new Date(),
          memo: "raw",
          idempotencyKey: uniq("raw"),
          lines: { create: [{ accountId: acct.id, debitPaise: 500n }] },
        },
      }),
    ).rejects.toThrow(/does not balance/);

    const e = await post(uniq("imm"));
    await expect(
      prisma.$executeRaw`UPDATE "JournalEntry" SET memo = 'tampered' WHERE id = ${e.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`DELETE FROM "JournalEntry" WHERE id = ${e.id}::uuid`).rejects.toThrow(
      /append-only/,
    );
    await expect(
      prisma.$executeRaw`UPDATE "JournalLine" SET "debitPaise" = 1 WHERE "entryId" = ${e.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`DELETE FROM "JournalLine" WHERE "entryId" = ${e.id}::uuid`).rejects.toThrow(
      /append-only/,
    );
  });

  it("reverses an entry by mirroring it, once only, and the books net to zero", async () => {
    const ref = uniq("rev");
    const before = await ledger.balance(ACCOUNTS.CASH, ref);
    const e = await ledger.post(db, {
      date: "2026-10-02",
      memo: "collection",
      idempotencyKey: ref,
      lines: [
        { account: ACCOUNTS.CASH, debitPaise: 5_000_00, dimension: ref },
        { account: ACCOUNTS.CHIT_PAYABLE, creditPaise: 5_000_00, dimension: ref },
      ],
    });
    expect(await ledger.balance(ACCOUNTS.CASH, ref)).toBe(before + 5_000_00);

    const r1 = await ledger.reverse(db, e.id, "entered in error", "2026-10-03");
    const r2 = await ledger.reverse(db, e.id, "entered in error", "2026-10-03");
    expect(r2.id).toBe(r1.id);
    expect(r1.reversesId).toBe(e.id);
    expect(r1.memo).toContain(e.number);
    expect(await ledger.balance(ACCOUNTS.CASH, ref)).toBe(before);
    await expect(ledger.reverse(db, r1.id, "x", "2026-10-04")).rejects.toMatchObject({
      response: { code: "IS_REVERSAL" },
    });
  });

  it("trial balance always balances and is permission-protected", async () => {
    const tb = await ledger.trialBalance();
    expect(tb.balanced).toBe(true);
    expect(tb.totals.debitPaise).toBe(tb.totals.creditPaise);

    const staff = await makeUser(app, "staff");
    const admin = await makeUser(app, "super_admin", { totp: true });
    const http = () => request(app.getHttpServer());
    expect((await http().get("/ledger/trial-balance")).status).toBe(401);
    expect(
      (
        await http()
          .get("/ledger/trial-balance")
          .set(await token(app, staff))
      ).status,
    ).toBe(403);
    expect(
      (
        await http()
          .get("/ledger/entries")
          .set(await token(app, staff))
      ).status,
    ).toBe(403);
    const res = await http()
      .get("/ledger/trial-balance")
      .set(await token(app, admin));
    expect(res.status).toBe(200);
    expect(res.body.balanced).toBe(true);
    expect(
      (
        await http()
          .get("/ledger/entries")
          .query({ pageSize: 5 })
          .set(await token(app, admin))
      ).body.items.length,
    ).toBeGreaterThan(0);
  });
});
