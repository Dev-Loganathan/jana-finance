import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type Loan, type LoanProduct } from "@prisma/client";
import {
  checkEligibility,
  monthlyInterest,
  yearlyPercent,
  type CreateLoanInput,
  type LoanProductInput,
  type ListQuery,
} from "@jana/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ACCOUNTS, LedgerService } from "../ledger/ledger.service";
import { StorageService, sniffMime } from "../storage/storage.service";
import type { AuthUser, ReqCtx } from "../common/decorators";
import { MAX_FILE_BYTES } from "../customers/kyc.service";
import { customerBrief, dateStr, loadHistories, num, personName, positionFor, today, type Tx } from "./loan.util";

const MAX_PHOTOS_PER_ITEM = 6;
const cashAccount = (mode: string) => (mode === "CASH" ? ACCOUNTS.CASH : ACCOUNTS.BANK);
const notFound = (what = "Loan") => new NotFoundException({ code: "NOT_FOUND", message: `${what} not found` });

export function toProductDto(p: LoanProduct) {
  return {
    id: p.id,
    name: p.name,
    monthlyRateBp: p.monthlyRateBp,
    minRateBp: p.minRateBp,
    maxRateBp: p.maxRateBp,
    minAmountPaise: num(p.minAmountPaise),
    maxAmountPaise: num(p.maxAmountPaise),
    processingFeeBp: p.processingFeeBp,
    processingFeeFlatPaise: num(p.processingFeeFlatPaise),
    active: p.active,
    notes: p.notes,
  };
}

@Injectable()
export class LoansService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private ledger: LedgerService,
    private storage: StorageService,
  ) {}

  /* ---------------- products ---------------- */

  async listProducts(includeInactive = false) {
    const rows = await this.prisma.loanProduct.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: "asc" },
    });
    return rows.map(toProductDto);
  }

  private productData(i: LoanProductInput) {
    return {
      name: i.name,
      monthlyRateBp: i.monthlyRateBp,
      minRateBp: i.minRateBp ?? i.monthlyRateBp,
      maxRateBp: i.maxRateBp ?? i.monthlyRateBp,
      minAmountPaise: BigInt(i.minAmountPaise),
      maxAmountPaise: BigInt(i.maxAmountPaise),
      processingFeeBp: i.processingFeeBp,
      processingFeeFlatPaise: BigInt(i.processingFeeFlatPaise),
      active: i.active,
      notes: i.notes ?? null,
    };
  }

  async createProduct(input: LoanProductInput, ctx: ReqCtx) {
    try {
      const p = await this.prisma.loanProduct.create({ data: this.productData(input) });
      await this.audit.record(ctx, {
        action: "loan.product_created",
        entity: "LoanProduct",
        entityId: p.id,
        after: input,
      });
      return toProductDto(p);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
        throw new ConflictException({ code: "DUPLICATE_NAME", message: "A product with that name already exists" });
      throw e;
    }
  }

  async updateProduct(id: string, input: LoanProductInput, ctx: ReqCtx) {
    const before = await this.prisma.loanProduct.findUnique({ where: { id } });
    if (!before) throw notFound("Product");
    try {
      const p = await this.prisma.loanProduct.update({ where: { id }, data: this.productData(input) });
      // Existing loans keep the rate and fee they were given: changing a product never touches them.
      await this.audit.record(ctx, {
        action: "loan.product_updated",
        entity: "LoanProduct",
        entityId: id,
        before: toProductDto(before),
        after: toProductDto(p),
      });
      return toProductDto(p);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
        throw new ConflictException({ code: "DUPLICATE_NAME", message: "A product with that name already exists" });
      throw e;
    }
  }

  /* ---------------- application ---------------- */

  private async eligibility(db: Tx, customerId: string, principalPaise: number, rateBp: number, exceptLoanId?: string) {
    const c = await db.customer.findFirst({ where: { id: customerId, deletedAt: null } });
    if (!c) throw notFound("Customer");
    const activeLoans = await db.loan.count({
      where: { customerId, status: { in: ["ACTIVE", "APPROVED"] }, ...(exceptLoanId && { id: { not: exceptLoanId } }) },
    });
    const result = checkEligibility({
      customer: {
        status: c.status,
        kycStatus: c.kycStatus,
        watchStatus: c.watchStatus,
        cibilScore: c.cibilScore,
        monthlyIncomePaise: num(c.monthlyIncomePaise),
        additionalIncomePaise: num(c.additionalIncomePaise),
        monthlyEmiPaise: num(c.monthlyEmiPaise),
      },
      principalPaise,
      monthlyRateBp: rateBp,
      activeLoans,
    });
    return { customer: c, ...result };
  }

  private checkAgainstProduct(product: LoanProduct, principalPaise: number, rateBp: number) {
    if (!product.active)
      throw new BadRequestException({ code: "PRODUCT_INACTIVE", message: "That loan product is not available" });
    if (principalPaise < num(product.minAmountPaise) || principalPaise > num(product.maxAmountPaise))
      throw new BadRequestException({
        code: "AMOUNT_OUT_OF_RANGE",
        message: `This product allows loans from Rs ${num(product.minAmountPaise) / 100} to Rs ${num(product.maxAmountPaise) / 100}`,
      });
    if (rateBp < product.minRateBp || rateBp > product.maxRateBp)
      throw new BadRequestException({
        code: "RATE_OUT_OF_RANGE",
        message: `This product allows ${product.minRateBp / 100}% to ${product.maxRateBp / 100}% a month`,
      });
  }

  private defaultFee(product: LoanProduct, principalPaise: number) {
    return Math.round((principalPaise * product.processingFeeBp) / 10_000) + num(product.processingFeeFlatPaise);
  }

  private static blocked(blockers: string[]) {
    return new UnprocessableEntityException({
      code: "NOT_ELIGIBLE",
      message: blockers.join(" "),
      blockers,
    });
  }

  /** What the application form shows as the user types: the fee, the monthly interest, and any findings. */
  async preview(customerId: string, productId: string, principalPaise: number, rateBp: number) {
    const product = await this.prisma.loanProduct.findUnique({ where: { id: productId } });
    if (!product) throw notFound("Product");
    const e = await this.eligibility(this.prisma, customerId, principalPaise, rateBp);
    return {
      monthlyInterestPaise: monthlyInterest(principalPaise, rateBp),
      yearlyPercent: yearlyPercent(rateBp),
      processingFeePaise: this.defaultFee(product, principalPaise),
      blockers: e.blockers,
      warnings: e.warnings,
    };
  }

  async create(input: CreateLoanInput, actor: AuthUser, ctx: ReqCtx) {
    const product = await this.prisma.loanProduct.findUnique({ where: { id: input.productId } });
    if (!product) throw notFound("Product");
    this.checkAgainstProduct(product, input.principalPaise, input.monthlyRateBp);
    const e = await this.eligibility(this.prisma, input.customerId, input.principalPaise, input.monthlyRateBp);
    if (e.blockers.length) throw LoansService.blocked(e.blockers);
    const fee = input.processingFeePaise ?? this.defaultFee(product, input.principalPaise);
    if (fee >= input.principalPaise)
      throw new BadRequestException({
        code: "BAD_FEE",
        message: "The processing fee must be less than the loan amount",
      });

    const id = await this.prisma.$transaction(async (tx) => {
      const seq = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('loan_seq')`;
      const loan = await tx.loan.create({
        data: {
          code: `LN${String(seq[0]!.nextval).padStart(6, "0")}`,
          customerId: input.customerId,
          productId: input.productId,
          principalPaise: BigInt(input.principalPaise),
          monthlyRateBp: input.monthlyRateBp,
          termMonths: input.termMonths,
          purpose: input.purpose,
          processingFeePaise: BigInt(fee),
          notes: input.notes,
          guarantorName: input.guarantorName,
          guarantorPhone: input.guarantorPhone || undefined,
          guarantorRelation: input.guarantorRelation,
          warnings: e.warnings,
          appliedById: actor.id,
        },
      });
      await this.audit.record(
        ctx,
        {
          action: "loan.applied",
          entity: "Loan",
          entityId: loan.id,
          after: {
            code: loan.code,
            principalPaise: input.principalPaise,
            monthlyRateBp: input.monthlyRateBp,
            warnings: e.warnings,
          },
        },
        tx,
      );
      return loan.id;
    });
    return this.get(id);
  }

  async update(id: string, input: Partial<CreateLoanInput>, actor: AuthUser, ctx: ReqCtx) {
    const loan = await this.prisma.loan.findUnique({ where: { id }, include: { product: true } });
    if (!loan) throw notFound();
    if (loan.status !== "APPLIED")
      throw new ConflictException({
        code: "BAD_STATE",
        message: "Only an application waiting for approval can be edited",
      });
    const principal = input.principalPaise ?? num(loan.principalPaise);
    const rate = input.monthlyRateBp ?? loan.monthlyRateBp;
    this.checkAgainstProduct(loan.product, principal, rate);
    const e = await this.eligibility(this.prisma, loan.customerId, principal, rate, id);
    if (e.blockers.length) throw LoansService.blocked(e.blockers);
    const fee =
      input.processingFeePaise ??
      (input.principalPaise !== undefined ? this.defaultFee(loan.product, principal) : num(loan.processingFeePaise));
    if (fee >= principal)
      throw new BadRequestException({
        code: "BAD_FEE",
        message: "The processing fee must be less than the loan amount",
      });
    await this.prisma.loan.update({
      where: { id },
      data: {
        principalPaise: BigInt(principal),
        monthlyRateBp: rate,
        processingFeePaise: BigInt(fee),
        termMonths: input.termMonths ?? loan.termMonths,
        purpose: input.purpose ?? loan.purpose,
        notes: input.notes ?? loan.notes,
        guarantorName: input.guarantorName ?? loan.guarantorName,
        guarantorPhone: input.guarantorPhone === undefined ? loan.guarantorPhone : input.guarantorPhone || null,
        guarantorRelation: input.guarantorRelation ?? loan.guarantorRelation,
        warnings: e.warnings,
      },
    });
    await this.audit.record(ctx, {
      action: "loan.updated",
      entity: "Loan",
      entityId: id,
      before: { principalPaise: num(loan.principalPaise), monthlyRateBp: loan.monthlyRateBp },
      after: { principalPaise: principal, monthlyRateBp: rate, by: actor.email },
    });
    return this.get(id);
  }

  /* ---------------- approval and disbursement ---------------- */

  async approve(id: string, overrideReason: string | undefined, actor: AuthUser, ctx: ReqCtx) {
    const loan = await this.prisma.loan.findUnique({ where: { id } });
    if (!loan) throw notFound();
    if (loan.status !== "APPLIED")
      throw new ConflictException({
        code: "BAD_STATE",
        message: "Only an application waiting for approval can be approved",
      });
    // Maker-checker: nobody approves their own application. The owner (locked Super Admin) is the one exception,
    // since in a small business they may be the only person entitled to approve.
    if (loan.appliedById === actor.id && !actor.roleLocked)
      throw new ForbiddenException({
        code: "SELF_APPROVAL",
        message: "Someone else must approve an application you entered",
      });
    // Look again now: things may have changed since the application was made.
    const e = await this.eligibility(this.prisma, loan.customerId, num(loan.principalPaise), loan.monthlyRateBp, id);
    if (e.blockers.length) throw LoansService.blocked(e.blockers);
    if (e.warnings.length && !overrideReason)
      throw new BadRequestException({
        code: "OVERRIDE_REQUIRED",
        message: "There are warnings on this application. Give a reason to approve it anyway.",
        warnings: e.warnings,
      });
    const claimed = await this.prisma.loan.updateMany({
      where: { id, status: "APPLIED" },
      data: {
        status: "APPROVED",
        approvedById: actor.id,
        approvedAt: new Date(),
        overrideReason: e.warnings.length ? overrideReason : null,
        warnings: e.warnings,
      },
    });
    if (!claimed.count)
      throw new ConflictException({ code: "BAD_STATE", message: "This application was just changed by someone else" });
    await this.audit.record(ctx, {
      action: "loan.approved",
      entity: "Loan",
      entityId: id,
      after: { code: loan.code, warnings: e.warnings, overrideReason: overrideReason ?? null },
    });
    return this.get(id);
  }

  async reject(id: string, reason: string, actor: AuthUser, ctx: ReqCtx) {
    const claimed = await this.prisma.loan.updateMany({
      where: { id, status: { in: ["APPLIED", "APPROVED"] } },
      data: { status: "REJECTED", rejectedById: actor.id, rejectedAt: new Date(), rejectionReason: reason },
    });
    if (!claimed.count) await this.explain(id);
    await this.audit.record(ctx, { action: "loan.rejected", entity: "Loan", entityId: id, after: { reason } });
    return this.get(id);
  }

  async cancel(id: string, ctx: ReqCtx) {
    const claimed = await this.prisma.loan.updateMany({
      where: { id, status: { in: ["APPLIED", "APPROVED"] } },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    if (!claimed.count) await this.explain(id);
    await this.audit.record(ctx, { action: "loan.cancelled", entity: "Loan", entityId: id });
    return this.get(id);
  }

  /** Called when a state change matched no row: say why, rather than a bare failure. */
  private async explain(id: string): Promise<never> {
    const l = await this.prisma.loan.findUnique({ where: { id }, select: { status: true } });
    if (!l) throw notFound();
    throw new ConflictException({
      code: "BAD_STATE",
      message: `This loan is ${l.status.toLowerCase()}, so that is not possible`,
    });
  }

  async disburse(
    id: string,
    input: { mode: string; reference?: string; disbursedOn?: string },
    actor: AuthUser,
    ctx: ReqCtx,
  ) {
    const t = today();
    const on = input.disbursedOn ?? t;
    if (on > t)
      throw new BadRequestException({ code: "FUTURE_DATE", message: "A loan cannot be disbursed on a future date" });
    if (on < t && !actor.permissions.includes("payment:backdate"))
      throw new ForbiddenException({
        code: "BACKDATE_FORBIDDEN",
        message: "You need the payment:backdate permission to record a disbursement with an earlier date",
      });
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Loan" WHERE id = ${id}::uuid FOR UPDATE`;
      const loan = await tx.loan.findUnique({
        where: { id },
        include: { customer: { select: { watchStatus: true } } },
      });
      if (!loan) throw notFound();
      if (loan.status !== "APPROVED")
        throw new ConflictException({ code: "BAD_STATE", message: "Only an approved loan can be disbursed" });
      if (loan.customer.watchStatus === "BLACKLIST")
        throw LoansService.blocked(["The customer is blacklisted, so no new loans can be given."]);
      const principal = num(loan.principalPaise);
      const fee = num(loan.processingFeePaise);
      await tx.loan.update({
        where: { id },
        data: {
          status: "ACTIVE",
          disbursedOn: new Date(`${on}T00:00:00Z`),
          disbursedAt: new Date(),
          disbursedById: actor.id,
          disbursalMode: input.mode as never,
          disbursalReference: input.reference,
        },
      });
      const entry = await this.ledger.post(tx, {
        date: on,
        memo: `Loan ${loan.code} disbursed`,
        refType: "Loan",
        refId: id,
        idempotencyKey: `loan-disburse:${id}`,
        postedById: actor.id,
        lines: [
          { account: ACCOUNTS.LOANS_RECEIVABLE, debitPaise: principal, dimension: id },
          { account: cashAccount(input.mode), creditPaise: principal - fee, dimension: id },
          { account: ACCOUNTS.FEE_INCOME, creditPaise: fee, dimension: id },
        ],
      });
      await tx.loan.update({ where: { id }, data: { disbursalJournalId: entry.id } });
      await this.audit.record(
        ctx,
        {
          action: "loan.disbursed",
          entity: "Loan",
          entityId: id,
          after: {
            code: loan.code,
            principalPaise: principal,
            feePaise: fee,
            netPaise: principal - fee,
            mode: input.mode,
            on,
          },
        },
        tx,
      );
    });
    return this.get(id);
  }

  /* ---------------- reading ---------------- */

  private async summarise(loans: (Loan & { product: { name: string } })[], asOf: string) {
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: [...new Set(loans.map((l) => l.customerId))] } },
      select: customerBrief,
    });
    const who = new Map(customers.map((c) => [c.id, c]));
    const histories = await loadHistories(
      this.prisma,
      loans.filter((l) => l.status === "ACTIVE" || l.status === "CLOSED").map((l) => l.id),
    );
    return loans.map((l) => {
      const pos = positionFor(l, histories.get(l.id) ?? { changes: [], paidByCycle: {}, lastPaidOn: null }, asOf);
      const c = who.get(l.customerId);
      return {
        id: l.id,
        code: l.code,
        status: l.status,
        productName: l.product.name,
        customer: c && { id: c.id, code: c.code, name: personName(c), phone: c.phone },
        principalPaise: num(l.principalPaise),
        monthlyRateBp: l.monthlyRateBp,
        disbursedOn: dateStr(l.disbursedOn),
        closedOn: dateStr(l.closedOn),
        principalOutstandingPaise: pos ? pos.principalOutstandingPaise : null,
        interestDuePaise: pos ? pos.interestDuePaise : null,
        interestOverduePaise: pos ? pos.interestOverduePaise : null,
        interestPayablePaise: pos ? pos.interestPayablePaise : null,
        nextDueDate: l.status === "ACTIVE" ? (pos?.nextDueDate ?? null) : null,
        overdueDays: pos ? pos.oldestOverdueDays : 0,
        createdAt: l.createdAt,
      };
    });
  }

  async list(q: ListQuery & { status?: string; customerId?: string }) {
    const search = q.q?.trim();
    const where: Prisma.LoanWhereInput = {
      ...(q.status && { status: q.status as never }),
      ...(q.customerId && { customerId: q.customerId }),
      ...(search && {
        OR: [
          { code: { contains: search, mode: "insensitive" } },
          { customer: { firstName: { contains: search, mode: "insensitive" } } },
          { customer: { lastName: { contains: search, mode: "insensitive" } } },
          { customer: { phone: { contains: search } } },
          { customer: { code: { contains: search, mode: "insensitive" } } },
        ],
      }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.loan.count({ where }),
      this.prisma.loan.findMany({
        where,
        include: { product: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { items: await this.summarise(rows, today()), total, page: q.page, pageSize: q.pageSize };
  }

  async stats() {
    const t = today();
    const [byStatus, active] = await Promise.all([
      this.prisma.loan.groupBy({ by: ["status"], _count: true }),
      this.prisma.loan.findMany({ where: { status: "ACTIVE" }, include: { product: { select: { name: true } } } }),
    ]);
    const rows = await this.summarise(active, t);
    const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count]));
    return {
      applied: counts.APPLIED ?? 0,
      approved: counts.APPROVED ?? 0,
      active: counts.ACTIVE ?? 0,
      closed: counts.CLOSED ?? 0,
      principalOutstandingPaise: rows.reduce((s, r) => s + (r.principalOutstandingPaise ?? 0), 0),
      interestDuePaise: rows.reduce((s, r) => s + (r.interestDuePaise ?? 0), 0),
      interestOverduePaise: rows.reduce((s, r) => s + (r.interestOverduePaise ?? 0), 0),
      overdueLoans: rows.filter((r) => (r.interestOverduePaise ?? 0) > 0).length,
    };
  }

  /**
   * The collector's worklist: every active loan with what to collect and when, most urgent first.
   * "overdue" = a finished month is unpaid past its due date; "today" = something falls due today; "week" = due in
   * the next 7 days.
   */
  async interestDue(
    q: { bucket: "overdue" | "today" | "week" | "all"; q?: string; asOf?: string },
    page = 1,
    pageSize = 50,
  ) {
    const asOf = q.asOf ?? today();
    const loans = await this.prisma.loan.findMany({
      where: { status: "ACTIVE" },
      include: { product: { select: { name: true } } },
    });
    let rows = await this.summarise(loans, asOf);
    const search = q.q?.trim().toLowerCase();
    if (search)
      rows = rows.filter((r) =>
        [r.code, r.customer?.name, r.customer?.phone, r.customer?.code].some((v) => v?.toLowerCase().includes(search)),
      );
    const weekEnd = new Date(Date.parse(`${asOf}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    const bucketOf = (r: (typeof rows)[number]) =>
      (r.interestOverduePaise ?? 0) > 0
        ? "overdue"
        : r.nextDueDate === asOf
          ? "today"
          : r.nextDueDate && r.nextDueDate > asOf && r.nextDueDate <= weekEnd
            ? "week"
            : "later";
    const counts = { overdue: 0, today: 0, week: 0 };
    for (const r of rows) {
      const b = bucketOf(r);
      if (b !== "later") counts[b]++;
    }
    const rank = { overdue: 0, today: 1, week: 2, later: 3 } as const;
    const kept = rows
      .filter((r) => q.bucket === "all" || bucketOf(r) === q.bucket)
      .sort(
        (a, b) =>
          rank[bucketOf(a)] - rank[bucketOf(b)] ||
          (b.overdueDays ?? 0) - (a.overdueDays ?? 0) ||
          (a.nextDueDate ?? "9").localeCompare(b.nextDueDate ?? "9"),
      );
    return {
      asOf,
      counts,
      totals: {
        interestDuePaise: kept.reduce((s, r) => s + (r.interestDuePaise ?? 0), 0),
        interestOverduePaise: kept.reduce((s, r) => s + (r.interestOverduePaise ?? 0), 0),
      },
      total: kept.length,
      page,
      pageSize,
      items: kept.slice((page - 1) * pageSize, page * pageSize).map((r) => ({ ...r, bucket: bucketOf(r) })),
    };
  }

  async get(id: string, asOf = today()) {
    const loan = await this.prisma.loan.findUnique({
      where: { id },
      include: {
        product: true,
        collaterals: {
          orderBy: { createdAt: "asc" },
          include: { files: { select: { id: true, label: true, mimeType: true } } },
        },
        payments: { orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }] },
      },
    });
    if (!loan) throw notFound();
    const [customer, histories, people] = await Promise.all([
      this.prisma.customer.findUnique({
        where: { id: loan.customerId },
        select: { ...customerBrief, kycStatus: true, watchStatus: true, cibilScore: true },
      }),
      loadHistories(this.prisma, [id]),
      this.prisma.user.findMany({
        where: {
          id: { in: [loan.appliedById, loan.approvedById, loan.disbursedById].filter((x): x is string => !!x) },
        },
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);
    const name = (uid: string | null) => {
      const u = people.find((p) => p.id === uid);
      return u ? `${u.firstName} ${u.lastName}`.trim() : null;
    };
    const history = histories.get(id)!;
    const pos = positionFor(loan, history, asOf);
    return {
      id: loan.id,
      code: loan.code,
      status: loan.status,
      asOf,
      customer: customer && {
        id: customer.id,
        code: customer.code,
        name: personName(customer),
        phone: customer.phone,
        kycStatus: customer.kycStatus,
        watchStatus: customer.watchStatus,
        cibilScore: customer.cibilScore,
      },
      product: toProductDto(loan.product),
      principalPaise: num(loan.principalPaise),
      monthlyRateBp: loan.monthlyRateBp,
      yearlyPercent: yearlyPercent(loan.monthlyRateBp),
      monthlyInterestPaise: monthlyInterest(num(loan.principalPaise), loan.monthlyRateBp),
      termMonths: loan.termMonths,
      purpose: loan.purpose,
      processingFeePaise: num(loan.processingFeePaise),
      notes: loan.notes,
      guarantor: loan.guarantorName
        ? { name: loan.guarantorName, phone: loan.guarantorPhone, relation: loan.guarantorRelation }
        : null,
      warnings: (loan.warnings as string[] | null) ?? [],
      overrideReason: loan.overrideReason,
      rejectionReason: loan.rejectionReason,
      appliedBy: name(loan.appliedById),
      approvedBy: name(loan.approvedById),
      approvedAt: loan.approvedAt,
      disbursedBy: name(loan.disbursedById),
      disbursedOn: dateStr(loan.disbursedOn),
      disbursalMode: loan.disbursalMode,
      closedOn: dateStr(loan.closedOn),
      createdAt: loan.createdAt,
      position: pos,
      collaterals: loan.collaterals.map((c) => ({
        id: c.id,
        kind: c.kind,
        description: c.description,
        estimatedValuePaise: num(c.estimatedValuePaise),
        reference: c.reference,
        status: c.status,
        releasedAt: c.releasedAt,
        releaseNote: c.releaseNote,
        files: c.files,
      })),
      payments: loan.payments.map((p) => ({
        id: p.id,
        receiptNo: p.receiptNo,
        paidOn: dateStr(p.paidOn),
        amountPaise: num(p.amountPaise),
        interestPaise: num(p.interestPaise),
        principalPaise: num(p.principalPaise),
        mode: p.mode,
        status: p.status,
      })),
      lastPaymentOn: history.lastPaidOn,
    };
  }

  /* ---------------- collateral ---------------- */

  private async ensureLoan(id: string) {
    const l = await this.prisma.loan.findUnique({
      where: { id },
      select: { id: true, customerId: true, status: true },
    });
    if (!l) throw notFound();
    return l;
  }

  async addCollateral(
    loanId: string,
    input: { kind: string; description: string; estimatedValuePaise: number; reference?: string },
    actor: AuthUser,
    ctx: ReqCtx,
  ) {
    const l = await this.ensureLoan(loanId);
    if (l.status === "REJECTED" || l.status === "CANCELLED")
      throw new ConflictException({ code: "BAD_STATE", message: "This loan is not going ahead" });
    const c = await this.prisma.loanCollateral.create({
      data: {
        loanId,
        kind: input.kind as never,
        description: input.description,
        estimatedValuePaise: BigInt(input.estimatedValuePaise),
        reference: input.reference,
        addedById: actor.id,
      },
    });
    await this.audit.record(ctx, {
      action: "loan.collateral_added",
      entity: "Loan",
      entityId: loanId,
      after: { ...input, id: c.id },
    });
    return this.get(loanId);
  }

  async releaseCollateral(loanId: string, collateralId: string, note: string | undefined, ctx: ReqCtx) {
    const c = await this.prisma.loanCollateral.findFirst({ where: { id: collateralId, loanId } });
    if (!c) throw notFound("Collateral");
    if (c.status === "RELEASED")
      throw new ConflictException({ code: "BAD_STATE", message: "That item has already been handed back" });
    const loan = await this.prisma.loan.findUniqueOrThrow({ where: { id: loanId }, select: { status: true } });
    // While money is owed the security stays; only a closed (or never-disbursed) loan gives it back.
    if (loan.status === "ACTIVE")
      throw new ConflictException({
        code: "LOAN_ACTIVE",
        message: "Collateral can be handed back only after the loan is closed",
      });
    await this.prisma.loanCollateral.update({
      where: { id: collateralId },
      data: { status: "RELEASED", releasedAt: new Date(), releaseNote: note },
    });
    await this.audit.record(ctx, {
      action: "loan.collateral_released",
      entity: "Loan",
      entityId: loanId,
      after: { collateralId, note: note ?? null },
    });
    return this.get(loanId);
  }

  async removeCollateral(loanId: string, collateralId: string, ctx: ReqCtx) {
    const c = await this.prisma.loanCollateral.findFirst({
      where: { id: collateralId, loanId },
      include: { files: true },
    });
    if (!c) throw notFound("Collateral");
    const loan = await this.prisma.loan.findUniqueOrThrow({ where: { id: loanId }, select: { status: true } });
    if (loan.status === "ACTIVE" || loan.status === "CLOSED")
      throw new ConflictException({
        code: "BAD_STATE",
        message: "Security held against a disbursed loan is a record of what was taken and cannot be deleted",
      });
    await this.prisma.loanCollateral.delete({ where: { id: collateralId } });
    await Promise.all(c.files.map((f) => this.storage.driver.delete(f.storageKey)));
    await this.audit.record(ctx, {
      action: "loan.collateral_removed",
      entity: "Loan",
      entityId: loanId,
      before: { description: c.description },
    });
    return this.get(loanId);
  }

  async addCollateralPhoto(
    loanId: string,
    collateralId: string,
    file: Express.Multer.File | undefined,
    label: string,
    actor: AuthUser,
    ctx: ReqCtx,
  ) {
    const loan = await this.ensureLoan(loanId);
    const c = await this.prisma.loanCollateral.findFirst({
      where: { id: collateralId, loanId },
      include: { files: true },
    });
    if (!c) throw notFound("Collateral");
    if (!file) throw new BadRequestException({ code: "NO_FILE", message: "Attach a photo" });
    if (file.size > MAX_FILE_BYTES)
      throw new PayloadTooLargeException({ code: "FILE_TOO_LARGE", message: "Files can be at most 5 MB" });
    const mime = sniffMime(file.buffer);
    if (!mime)
      throw new BadRequestException({
        code: "UNSUPPORTED_FILE",
        message: "Only JPG, PNG, WebP or PDF files are accepted",
      });
    if (c.files.length >= MAX_PHOTOS_PER_ITEM)
      throw new BadRequestException({
        code: "TOO_MANY_FILES",
        message: `At most ${MAX_PHOTOS_PER_ITEM} files per item`,
      });
    const scan = await this.storage.scanner.scan(file.buffer, file.originalname);
    if (!scan.clean)
      throw new BadRequestException({ code: "INFECTED_FILE", message: "The file failed the security scan" });
    const key = `loans/${loanId}/${randomUUID()}`;
    await this.storage.driver.put(key, file.buffer);
    try {
      await this.prisma.customerFile.create({
        data: {
          customerId: loan.customerId,
          collateralId,
          label: label.slice(0, 40),
          storageKey: key,
          mimeType: mime,
          sizeBytes: file.size,
          sha256: createHash("sha256").update(file.buffer).digest("hex"),
          originalName: file.originalname.slice(0, 120),
          uploadedById: actor.id,
        },
      });
    } catch (e) {
      await this.storage.driver.delete(key);
      throw e;
    }
    await this.audit.record(ctx, {
      action: "loan.collateral_photo_added",
      entity: "Loan",
      entityId: loanId,
      after: { collateralId, mime, size: file.size },
    });
    return this.get(loanId);
  }

  async removeCollateralPhoto(loanId: string, fileId: string, ctx: ReqCtx) {
    const f = await this.prisma.customerFile.findFirst({ where: { id: fileId, collateral: { loanId } } });
    if (!f) throw notFound("File");
    await this.prisma.customerFile.delete({ where: { id: fileId } });
    await this.storage.driver.delete(f.storageKey);
    await this.audit.record(ctx, {
      action: "loan.collateral_photo_removed",
      entity: "Loan",
      entityId: loanId,
      after: { fileId },
    });
    return this.get(loanId);
  }

  /** 60-second signed link, audited like KYC documents. */
  async photoUrl(fileId: string, ctx: ReqCtx) {
    const f = await this.prisma.customerFile.findFirst({
      where: { id: fileId, collateralId: { not: null } },
      include: { collateral: { select: { loanId: true } } },
    });
    if (!f) throw notFound("File");
    await this.audit.record(ctx, {
      action: "loan.collateral_photo_viewed",
      entity: "Loan",
      entityId: f.collateral!.loanId,
      after: { fileId },
    });
    return this.storage.signedUrl(fileId);
  }
}
