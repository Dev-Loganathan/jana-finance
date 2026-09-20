import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type KycDocType } from "@prisma/client";
import {
  ID_VALIDATORS,
  KYC_NUMBERED_TYPES,
  WIZARD_STEPS,
  deriveKycStatus,
  draftStepSchema,
  employmentStepSchema,
  evaluate,
  paiseToRupees,
  type CustomerListQuery,
  type KycNumberedType,
  type WizardStep,
} from "@jana/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CryptoService } from "../common/crypto.service";
import { StorageService } from "../storage/storage.service";
import type { AuthUser, ReqCtx } from "../common/decorators";
import { toCustomerDto, type FullCustomer } from "./customer.dto";
import { toCsv } from "./csv";

const INCLUDE = {
  documents: { include: { files: true } },
  bank: true,
  references: true,
} satisfies Prisma.CustomerInclude;
const SORTABLE = new Set(["code", "firstName", "cibilScore", "riskLevel", "status", "createdAt"]);

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const num = (v: bigint | number) => Number(v);

/** Which wizard steps are complete, based on what is actually stored. */
export function computeCompletion(c: FullCustomer): WizardStep[] {
  const done: WizardStep[] = [];
  if (c.firstName && c.gender && c.dob && c.phone && c.maritalStatus) done.push("basic");
  if (c.currentAddress && c.permanentAddress && c.state && c.district && c.pincode && c.residenceType)
    done.push("address");
  const hasNumber = (t: KycDocType) => c.documents.some((d) => d.type === t && !!d.numberEnc);
  if (hasNumber("AADHAAR") && hasNumber("PAN")) done.push("kyc");
  if (c.occupationType && c.bank.length > 0) done.push("employment");
  if (c.fatherName && c.motherName && c.nomineeName && c.nomineeRelation && c.references.length > 0)
    done.push("references");
  if (c.cibilScore !== null) done.push("evaluation");
  return done;
}

@Injectable()
export class CustomersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private crypto: CryptoService,
    private storage: StorageService,
  ) {}

  private canSeeKyc = (u: AuthUser) => u.permissions.includes("kyc:view");

  async load(id: string, tx: Prisma.TransactionClient | PrismaService = this.prisma): Promise<FullCustomer> {
    const c = await tx.customer.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
    if (!c) throw new NotFoundException({ code: "NOT_FOUND", message: "Customer not found" });
    return c;
  }

  /** Recomputes derived fields (completed steps, KYC status, risk) after any change. */
  async refresh(tx: Prisma.TransactionClient, id: string, lastStep?: string) {
    const c = await this.load(id, tx);
    const data: Prisma.CustomerUpdateInput = {
      completedSteps: computeCompletion(c),
      kycStatus: deriveKycStatus(
        c.documents.map((d) => ({
          type: d.type,
          status: d.status,
          hasFile: d.files.length > 0,
          hasNumber: !!d.numberEnc,
        })),
      ),
    };
    if (lastStep) data.lastStep = lastStep;
    if (c.cibilScore !== null) {
      const e = evaluate({
        cibilScore: c.cibilScore,
        monthlyIncomePaise: num(c.monthlyIncomePaise),
        additionalIncomePaise: num(c.additionalIncomePaise),
        monthlyEmiPaise: num(c.monthlyEmiPaise),
      });
      Object.assign(data, { dtiBp: e.dtiBp, riskLevel: e.riskLevel, category: e.category });
    }
    await tx.customer.update({ where: { id }, data });
  }

  /* ---------------- list / read ---------------- */

  async list(q: CustomerListQuery) {
    const where: Prisma.CustomerWhereInput = { deletedAt: null };
    // Drafts live in their own "Partially Saved" tab, so the default list shows real customers only.
    where.status = q.status ?? { not: "DRAFT" };
    if (q.risk) where.riskLevel = q.risk;
    if (q.category) where.category = q.category;
    if (q.kyc) where.kycStatus = q.kyc;
    if (q.watch) where.watchStatus = q.watch;
    if (q.tag) where.tags = { has: q.tag };
    if (q.cibilMin !== undefined || q.cibilMax !== undefined) where.cibilScore = { gte: q.cibilMin, lte: q.cibilMax };
    if (q.q) {
      const term = q.q.replace(/[\s-]/g, "");
      const or: Prisma.CustomerWhereInput[] = ["firstName", "lastName", "phone", "code", "email"].map((f) => ({
        [f]: { contains: q.q, mode: "insensitive" },
      }));
      // Aadhaar / PAN are found through the blind index: exact match only, never a partial scan of encrypted values.
      if (/^\d{12}$/.test(term))
        or.push({ documents: { some: { type: "AADHAAR", numberHash: this.crypto.blindIndex(term) } } });
      if (/^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(term))
        or.push({ documents: { some: { type: "PAN", numberHash: this.crypto.blindIndex(term.toUpperCase()) } } });
      where.OR = or;
    }
    const [field, dir] = q.sort?.split(":") ?? ["createdAt", "desc"];
    const orderBy = { [SORTABLE.has(field!) ? field! : "createdAt"]: dir === "asc" ? "asc" : "desc" };

    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { documents: { where: { type: "PHOTO" }, include: { files: { take: 1 } } } },
      }),
      this.prisma.customer.count({ where }),
    ]);
    return {
      items: rows.map((c) => {
        const photo = c.documents[0]?.files[0];
        return {
          id: c.id,
          code: c.code,
          name: `${c.firstName} ${c.lastName}`.trim(),
          phone: c.phone,
          city: c.district,
          occupationType: c.occupationType,
          cibilScore: c.cibilScore,
          riskLevel: c.riskLevel,
          category: c.category,
          status: c.status,
          kycStatus: c.kycStatus,
          watchStatus: c.watchStatus,
          consentGiven: !!c.consentAt,
          tags: c.tags,
          completedSteps: c.completedSteps,
          updatedAt: c.updatedAt,
          photoUrl: photo ? this.storage.signedUrl(photo.id, 600).url : null,
        };
      }),
      page: q.page,
      pageSize: q.pageSize,
      total,
    };
  }

  async stats() {
    const base = { deletedAt: null };
    const [total, active, inactive, highRisk, drafts] = await Promise.all([
      this.prisma.customer.count({ where: { ...base, status: { not: "DRAFT" } } }),
      this.prisma.customer.count({ where: { ...base, status: "ACTIVE" } }),
      this.prisma.customer.count({ where: { ...base, status: "INACTIVE" } }),
      this.prisma.customer.count({ where: { ...base, status: { not: "DRAFT" }, riskLevel: "HIGH" } }),
      this.prisma.customer.count({ where: { ...base, status: "DRAFT" } }),
    ]);
    return { total, active, inactive, highRisk, drafts };
  }

  async get(actor: AuthUser, id: string) {
    return toCustomerDto(await this.load(id), { canSeeKyc: this.canSeeKyc(actor) });
  }

  async activity(id: string) {
    await this.load(id);
    const rows = await this.prisma.auditLog.findMany({
      where: { entity: { in: ["Customer", "KycDocument"] }, entityId: id },
      orderBy: { id: "desc" },
      take: 100,
    });
    return rows.map((r) => ({ id: r.id.toString(), at: r.at, by: r.userEmail, action: r.action }));
  }

  /* ---------------- create / steps / submit ---------------- */

  async create(actor: AuthUser, input: { firstName?: string; lastName?: string; phone?: string }, ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const seq = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('customer_code_seq')`;
      const nextval = seq[0]!.nextval;
      const c = await tx.customer.create({
        data: {
          code: `CUS${nextval}`,
          firstName: input.firstName ?? "",
          lastName: input.lastName ?? "",
          phone: input.phone,
          createdById: actor.id,
        },
      });
      await this.refresh(tx, c.id, "basic");
      await this.audit.record(
        ctx,
        { action: "customer.create", entity: "Customer", entityId: c.id, after: { code: c.code } },
        tx,
      );
      return toCustomerDto(await this.load(c.id, tx), { canSeeKyc: this.canSeeKyc(actor) });
    });
  }

  async saveStep(actor: AuthUser, id: string, step: WizardStep, raw: unknown, ctx: ReqCtx) {
    const parsed = (step === "employment" ? draftStepSchemaWithPartialBank() : draftStepSchema(step)).safeParse(raw);
    if (!parsed.success)
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Validation failed",
        errors: parsed.error.flatten(),
      });
    const d = parsed.data as Record<string, unknown>;

    if (step === "kyc" && !actor.permissions.includes("kyc:upload")) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "You do not have permission to enter KYC numbers" });
    }

    return this.prisma.$transaction(async (tx) => {
      const before = await this.load(id, tx);
      if (before.status === "INACTIVE")
        throw new BadRequestException({ code: "INACTIVE", message: "Re-activate the customer before editing" });
      const data: Prisma.CustomerUpdateInput = {};
      const set = <K extends keyof Prisma.CustomerUpdateInput>(k: K, v: unknown) => {
        if (v !== undefined) (data as Record<string, unknown>)[k] = blank(v);
      };

      switch (step) {
        case "basic":
          for (const k of ["firstName", "lastName", "gender", "phone", "altPhone", "email", "maritalStatus"] as const)
            set(k, d[k]);
          if (d.dob !== undefined) data.dob = new Date(`${d.dob as string}T00:00:00Z`);
          break;
        case "address":
          for (const k of [
            "currentAddress",
            "permanentAddress",
            "country",
            "state",
            "district",
            "pincode",
            "landmark",
            "residenceType",
          ] as const)
            set(k, d[k]);
          break;
        case "kyc":
          await this.saveIdNumbers(tx, id, d);
          break;
        case "employment": {
          for (const k of ["occupationType", "companyName", "designation", "workExperience", "businessName"] as const)
            set(k, d[k]);
          if (d.monthlyIncomePaise !== undefined) data.monthlyIncomePaise = BigInt(d.monthlyIncomePaise as number);
          if (d.additionalIncomePaise !== undefined)
            data.additionalIncomePaise = BigInt(d.additionalIncomePaise as number);
          if (d.bank)
            await this.saveBank(tx, id, d.bank as { bankName?: string; accountNumber?: string; ifsc?: string });
          break;
        }
        case "references":
          for (const k of ["fatherName", "motherName", "spouseName", "nomineeName", "nomineeRelation"] as const)
            set(k, d[k]);
          if (d.references) {
            await tx.customerReference.deleteMany({ where: { customerId: id } });
            await tx.customerReference.createMany({
              data: (d.references as { name: string; mobile: string }[]).map((r, i) => ({
                customerId: id,
                name: r.name,
                mobile: r.mobile,
                position: i,
              })),
            });
          }
          break;
        case "evaluation":
          set("cibilScore", d.cibilScore);
          set("existingLoans", d.existingLoans);
          if (d.monthlyEmiPaise !== undefined) data.monthlyEmiPaise = BigInt(d.monthlyEmiPaise as number);
          if (d.consentGiven === true && !before.consentAt) {
            data.consentAt = new Date();
            data.consentById = actor.id;
          }
          break;
      }

      if (Object.keys(data).length) await tx.customer.update({ where: { id }, data });
      await this.refresh(tx, id, step);
      await this.audit.record(
        ctx,
        { action: "customer.step_saved", entity: "Customer", entityId: id, after: { step, fields: Object.keys(d) } },
        tx,
      );
      return toCustomerDto(await this.load(id, tx), { canSeeKyc: this.canSeeKyc(actor) });
    });
  }

  private async saveIdNumbers(tx: Prisma.TransactionClient, customerId: string, d: Record<string, unknown>) {
    const map: Record<string, KycNumberedType> = {
      aadhaar: "AADHAAR",
      pan: "PAN",
      voterId: "VOTER_ID",
      drivingLicence: "DRIVING_LICENCE",
      passport: "PASSPORT",
    };
    for (const [field, type] of Object.entries(map)) {
      const value = d[field];
      if (typeof value !== "string" || value === "") continue;
      const normalized = ID_VALIDATORS[type].parse(value);
      const number = {
        numberEnc: this.crypto.encrypt(normalized),
        numberLast4: normalized.slice(-4),
        numberLength: normalized.length,
        numberHash: this.crypto.blindIndex(normalized),
      };
      const existing = await tx.kycDocument.findUnique({ where: { customerId_type: { customerId, type } } });
      if (existing?.numberHash === number.numberHash) continue; // unchanged: keep the verification
      // A changed number must be verified again.
      await tx.kycDocument.upsert({
        where: { customerId_type: { customerId, type } },
        create: { customerId, type, ...number },
        update: { ...number, status: "PENDING", verifiedAt: null, verifiedById: null, rejectionReason: null },
      });
    }
  }

  private async saveBank(
    tx: Prisma.TransactionClient,
    customerId: string,
    b: { bankName?: string; accountNumber?: string; ifsc?: string },
  ) {
    const existing = await tx.bankAccount.findFirst({ where: { customerId, isPrimary: true } });
    if (b.accountNumber) {
      const acct = {
        accountNumberEnc: this.crypto.encrypt(b.accountNumber),
        accountLast4: b.accountNumber.slice(-4),
        accountLength: b.accountNumber.length,
        accountHash: this.crypto.blindIndex(b.accountNumber),
      };
      if (existing)
        await tx.bankAccount.update({
          where: { id: existing.id },
          data: { ...acct, ...(b.bankName && { bankName: b.bankName }), ...(b.ifsc && { ifsc: b.ifsc }) },
        });
      else if (b.bankName && b.ifsc)
        await tx.bankAccount.create({ data: { customerId, bankName: b.bankName, ifsc: b.ifsc, ...acct } });
    } else if (existing) {
      await tx.bankAccount.update({
        where: { id: existing.id },
        data: { ...(b.bankName && { bankName: b.bankName }), ...(b.ifsc && { ifsc: b.ifsc }) },
      });
    }
  }

  async submit(actor: AuthUser, id: string, acknowledge: boolean, ctx: ReqCtx) {
    const c = await this.load(id);
    if (c.status !== "DRAFT")
      throw new BadRequestException({ code: "NOT_A_DRAFT", message: "Only drafts can be submitted" });
    const missing = WIZARD_STEPS.filter((s) => !c.completedSteps.includes(s));
    if (missing.length || !c.consentAt) {
      throw new BadRequestException({
        code: "INCOMPLETE",
        message: "Complete every step and record the customer's consent before submitting",
        missing,
        consentMissing: !c.consentAt,
      });
    }
    if (!acknowledge) {
      const matches = await this.findDuplicates({ customerId: id });
      if (matches.length)
        throw new ConflictException({
          code: "DUPLICATE_SUSPECTED",
          message: "This customer may already exist",
          matches,
        });
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id }, data: { status: "ACTIVE", submittedAt: new Date() } });
      await this.audit.record(
        ctx,
        { action: "customer.submit", entity: "Customer", entityId: id, after: { acknowledgedDuplicates: acknowledge } },
        tx,
      );
      return toCustomerDto(await this.load(id, tx), { canSeeKyc: this.canSeeKyc(actor) });
    });
  }

  /* ---------------- duplicates ---------------- */

  /**
   * Looks for existing customers by phone, Aadhaar/PAN (blind index), and name+DOB (fuzzy). Pass `customerId` to
   * check a stored customer, or raw values to check before saving.
   */
  async findDuplicates(q: {
    customerId?: string;
    phone?: string;
    aadhaar?: string;
    pan?: string;
    name?: string;
    dob?: string;
    excludeId?: string;
  }) {
    let { phone, name, dob } = q;
    let aadhaarHash: string | undefined;
    let panHash: string | undefined;

    if (q.customerId) {
      const c = await this.load(q.customerId);
      phone = c.phone ?? undefined;
      name = `${c.firstName} ${c.lastName}`.trim();
      dob = c.dob?.toISOString().slice(0, 10);
      aadhaarHash = c.documents.find((d) => d.type === "AADHAAR")?.numberHash ?? undefined;
      panHash = c.documents.find((d) => d.type === "PAN")?.numberHash ?? undefined;
    } else {
      const a = q.aadhaar ? ID_VALIDATORS.AADHAAR.safeParse(q.aadhaar) : undefined;
      const p = q.pan ? ID_VALIDATORS.PAN.safeParse(q.pan) : undefined;
      if (a?.success) aadhaarHash = this.crypto.blindIndex(a.data);
      if (p?.success) panHash = this.crypto.blindIndex(p.data);
    }
    const exclude = q.customerId ?? q.excludeId;
    const reasons = new Map<string, string[]>();
    const add = (id: string, why: string) => reasons.set(id, [...(reasons.get(id) ?? []), why]);

    if (phone) {
      const rows = await this.prisma.customer.findMany({
        where: { deletedAt: null, id: { not: exclude }, OR: [{ phone }, { altPhone: phone }] },
        select: { id: true },
      });
      rows.forEach((r) => add(r.id, "Same mobile number"));
    }
    for (const [type, hash, label] of [
      ["AADHAAR", aadhaarHash, "Same Aadhaar"],
      ["PAN", panHash, "Same PAN"],
    ] as const) {
      if (!hash) continue;
      const rows = await this.prisma.kycDocument.findMany({
        where: { type, numberHash: hash, customer: { deletedAt: null, id: { not: exclude } } },
        select: { customerId: true },
      });
      rows.forEach((r) => add(r.customerId, label));
    }
    if (name && dob && /^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Customer"
        WHERE "deletedAt" IS NULL AND dob = ${dob}::date AND (${exclude ?? null}::uuid IS NULL OR id <> ${exclude ?? null}::uuid)
          AND similarity(lower("firstName" || ' ' || "lastName"), lower(${name})) > 0.5`;
      rows.forEach((r) => add(r.id, "Similar name and same date of birth"));
    }
    if (reasons.size === 0) return [];
    const found = await this.prisma.customer.findMany({
      where: { id: { in: [...reasons.keys()] } },
      select: { id: true, code: true, firstName: true, lastName: true, phone: true, status: true },
    });
    return found.map((f) => ({
      id: f.id,
      code: f.code,
      name: `${f.firstName} ${f.lastName}`.trim(),
      phone: f.phone,
      status: f.status,
      reasons: reasons.get(f.id)!,
    }));
  }

  /* ---------------- notes, follow-ups, tags, watch status ---------------- */

  async listNotes(id: string) {
    await this.load(id);
    return this.prisma.customerNote.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, take: 200 });
  }

  async addNote(
    actor: AuthUser,
    id: string,
    input: { kind: "NOTE" | "CALL" | "VISIT"; body: string; outcome?: string; followUpOn?: string },
    ctx: ReqCtx,
  ) {
    await this.load(id);
    return this.prisma.$transaction(async (tx) => {
      const n = await tx.customerNote.create({
        data: {
          customerId: id,
          kind: input.kind,
          body: input.body,
          outcome: input.outcome || null,
          followUpOn: input.followUpOn ? new Date(`${input.followUpOn}T00:00:00Z`) : null,
          authorId: actor.id,
          authorName: actor.name,
        },
      });
      await this.audit.record(
        ctx,
        {
          action: "customer.note_added",
          entity: "Customer",
          entityId: id,
          after: { kind: input.kind, followUpOn: input.followUpOn },
        },
        tx,
      );
      return n;
    });
  }

  async completeNote(id: string, noteId: string, ctx: ReqCtx) {
    const n = await this.prisma.customerNote.findFirst({ where: { id: noteId, customerId: id } });
    if (!n) throw new NotFoundException({ code: "NOT_FOUND", message: "Note not found" });
    if (!n.followUpOn)
      throw new BadRequestException({ code: "NOT_A_TASK", message: "This note has no follow-up date" });
    return this.prisma.$transaction(async (tx) => {
      const u = await tx.customerNote.update({
        where: { id: noteId },
        data: { completedAt: n.completedAt ? null : new Date() },
      });
      await this.audit.record(
        ctx,
        {
          action: u.completedAt ? "customer.followup_done" : "customer.followup_reopened",
          entity: "Customer",
          entityId: id,
        },
        tx,
      );
      return u;
    });
  }

  /** Open follow-up tasks due on or before a date (default today), across all customers. Feeds collections later. */
  async followUpsDue(upTo?: string) {
    const limit = new Date(`${upTo ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const rows = await this.prisma.customerNote.findMany({
      where: { completedAt: null, followUpOn: { lte: limit }, customer: { deletedAt: null } },
      orderBy: { followUpOn: "asc" },
      take: 200,
      include: { customer: { select: { id: true, code: true, firstName: true, lastName: true, phone: true } } },
    });
    return rows.map((n) => ({
      id: n.id,
      kind: n.kind,
      body: n.body,
      outcome: n.outcome,
      followUpOn: n.followUpOn!.toISOString().slice(0, 10),
      customer: {
        id: n.customer.id,
        code: n.customer.code,
        name: `${n.customer.firstName} ${n.customer.lastName}`.trim(),
        phone: n.customer.phone,
      },
    }));
  }

  async setTags(actor: AuthUser, id: string, tags: string[], ctx: ReqCtx) {
    const before = await this.load(id);
    const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
    return this.prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id }, data: { tags: clean } });
      await this.audit.record(
        ctx,
        {
          action: "customer.tags_changed",
          entity: "Customer",
          entityId: id,
          before: { tags: before.tags },
          after: { tags: clean },
        },
        tx,
      );
      return toCustomerDto(await this.load(id, tx), { canSeeKyc: this.canSeeKyc(actor) });
    });
  }

  /**
   * Watchlist / blacklist with a mandatory reason. The second-person approval from the brief plugs in when the generic
   * approvals engine is built; until then this is gated by its own permission (customer:blacklist) and fully audited.
   */
  async setWatch(
    actor: AuthUser,
    id: string,
    status: "NONE" | "WATCHLIST" | "BLACKLIST",
    reason: string | undefined,
    ctx: ReqCtx,
  ) {
    const before = await this.load(id);
    return this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id },
        data: {
          watchStatus: status,
          watchReason: status === "NONE" ? null : reason,
          watchSetById: status === "NONE" ? null : actor.id,
          watchSetAt: status === "NONE" ? null : new Date(),
        },
      });
      await this.audit.record(
        ctx,
        {
          action: "customer.watch_changed",
          entity: "Customer",
          entityId: id,
          before: { status: before.watchStatus, reason: before.watchReason },
          after: { status, reason },
        },
        tx,
      );
      return toCustomerDto(await this.load(id, tx), { canSeeKyc: this.canSeeKyc(actor) });
    });
  }

  /**
   * CSV export of the current filter. Contains no ID or account numbers (not even masked ones): it is meant for
   * reporting and mailing lists. Every export is audited with the row count and filters.
   */
  async exportCsv(q: CustomerListQuery, ctx: ReqCtx) {
    const rows = await this.prisma.customer.findMany({
      where: await this.exportWhere(q),
      orderBy: { code: "asc" },
      take: 5000,
    });
    await this.audit.record(ctx, {
      action: "customer.export",
      entity: "Customer",
      after: { count: rows.length, filters: { ...q, page: undefined, pageSize: undefined } },
    });
    return toCsv([
      [
        "Code",
        "Name",
        "Status",
        "KYC",
        "Mobile",
        "Email",
        "District",
        "State",
        "Occupation",
        "Monthly income (INR)",
        "CIBIL",
        "Risk",
        "Category",
        "Watch status",
        "Tags",
        "Created",
      ],
      ...rows.map((c) => [
        c.code,
        `${c.firstName} ${c.lastName}`.trim(),
        c.status,
        c.kycStatus,
        c.phone,
        c.email,
        c.district,
        c.state,
        c.occupationType,
        paiseToRupees(num(c.monthlyIncomePaise)),
        c.cibilScore,
        c.riskLevel,
        c.category,
        c.watchStatus,
        c.tags.join("; "),
        c.createdAt.toISOString().slice(0, 10),
      ]),
    ]);
  }

  private async exportWhere(q: CustomerListQuery): Promise<Prisma.CustomerWhereInput> {
    // Reuse the list filtering by asking for a single huge page and taking its ids.
    const ids = await this.list({ ...q, page: 1, pageSize: 100 }).then(async (first) => {
      if (first.total <= 100) return first.items.map((i) => i.id);
      const all: string[] = [];
      for (let p = 1; p <= Math.ceil(Math.min(first.total, 5000) / 100); p++)
        all.push(...(await this.list({ ...q, page: p, pageSize: 100 })).items.map((i) => i.id));
      return all;
    });
    return { id: { in: ids } };
  }

  /* ---------------- status / delete / reveal ---------------- */

  async setStatus(actor: AuthUser, id: string, status: "ACTIVE" | "INACTIVE", ctx: ReqCtx) {
    const before = await this.load(id);
    if (before.status === "DRAFT")
      throw new BadRequestException({ code: "IS_DRAFT", message: "Submit the draft first" });
    return this.prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id }, data: { status } });
      await this.audit.record(
        ctx,
        {
          action: "customer.status_changed",
          entity: "Customer",
          entityId: id,
          before: { status: before.status },
          after: { status },
        },
        tx,
      );
      return toCustomerDto(await this.load(id, tx), { canSeeKyc: this.canSeeKyc(actor) });
    });
  }

  async remove(id: string, ctx: ReqCtx) {
    const before = await this.load(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(
        ctx,
        {
          action: "customer.delete",
          entity: "Customer",
          entityId: id,
          before: { code: before.code, status: before.status },
        },
        tx,
      );
    });
  }

  /** The only path that returns a plaintext ID or account number. Permission-gated and always audited. */
  async reveal(id: string, field: (typeof KYC_NUMBERED_TYPES)[number] | "BANK_ACCOUNT", ctx: ReqCtx) {
    const c = await this.load(id);
    let enc: string | null | undefined;
    if (field === "BANK_ACCOUNT") enc = c.bank[0]?.accountNumberEnc;
    else enc = c.documents.find((d) => d.type === field)?.numberEnc;
    if (!enc) throw new NotFoundException({ code: "NOT_FOUND", message: "Nothing stored for this field" });
    await this.audit.record(ctx, {
      action: "kyc.reveal_sensitive",
      entity: "Customer",
      entityId: id,
      after: { field },
    });
    return { field, value: this.crypto.decrypt(enc) };
  }
}

/** Draft variant of the employment step where the nested bank object may also be incomplete. */
function draftStepSchemaWithPartialBank() {
  return employmentStepSchema.extend({ bank: employmentStepSchema.shape.bank.partial() }).partial();
}
