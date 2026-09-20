import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { IMPORT_COLUMNS, validateImportRow, type ImportedSteps, type RowError } from "@jana/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CryptoService } from "../common/crypto.service";
import type { AuthUser, ReqCtx } from "../common/decorators";
import { CustomersService } from "../customers/customers.service";
import { ExcelService, type ErrorRow } from "./excel.service";

const RETENTION_MS = 24 * 60 * 60 * 1000;
const STUCK_MS = 15 * 60 * 1000;
const STEPS = ["basic", "address", "kyc", "employment", "references", "evaluation"] as const;

type Values = Record<string, string | number | null>;
interface StoredRow {
  row: number;
  name: string;
  status: "ready" | "error" | "duplicate";
  values: Values;
  errors: RowError[];
  duplicates: { code: string; name: string; reasons: string[] }[];
  steps?: ImportedSteps;
}

const header = (key: string) => IMPORT_COLUMNS.find((c) => c.key === key)?.header ?? key;

@Injectable()
export class BulkImportService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private crypto: CryptoService,
    private customers: CustomersService,
    private excel: ExcelService,
  ) {}

  template() {
    return this.excel.build();
  }

  /** Removes rows (which contain ID and bank numbers) from batches past their retention period. */
  async purgeExpired() {
    const now = new Date();
    await this.prisma.importBatch.updateMany({
      where: { expiresAt: { lt: now }, status: "VALIDATED" },
      data: { status: "EXPIRED", dataEnc: null },
    });
    await this.prisma.importBatch.updateMany({
      where: { expiresAt: { lt: now }, dataEnc: { not: null } },
      data: { dataEnc: null },
    });
    // A crashed import must not leave a batch locked forever
    await this.prisma.importBatch.updateMany({
      where: { status: "IMPORTING", createdAt: { lt: new Date(Date.now() - STUCK_MS) } },
      data: { status: "VALIDATED" },
    });
  }

  private async load(actor: AuthUser, id: string) {
    await this.purgeExpired();
    const b = await this.prisma.importBatch.findUnique({ where: { id } });
    if (!b) throw new NotFoundException({ code: "NOT_FOUND", message: "Import not found" });
    if (b.createdById !== actor.id && !actor.roleLocked)
      throw new ForbiddenException({ code: "FORBIDDEN", message: "This import belongs to someone else" });
    return b;
  }

  private rowsOf(b: { dataEnc: string | null }): StoredRow[] {
    if (!b.dataEnc)
      throw new BadRequestException({
        code: "EXPIRED",
        message: "This upload has expired and its data has been removed. Upload the file again.",
      });
    return JSON.parse(this.crypto.decrypt(b.dataEnc)) as StoredRow[];
  }

  private report(batchId: string, fileName: string, expiresAt: Date, rows: StoredRow[], ignored: string[] = []) {
    return {
      batchId,
      fileName,
      expiresAt,
      total: rows.length,
      ready: rows.filter((r) => r.status === "ready").length,
      errors: rows.filter((r) => r.status === "error").length,
      duplicates: rows.filter((r) => r.status === "duplicate").length,
      ignoredColumns: ignored,
      // No ID or bank numbers here: names, row numbers and messages only
      rows: rows.map((r) => ({
        row: r.row,
        name: r.name,
        status: r.status,
        errors: r.errors.map((e) => ({ column: e.column, header: header(e.column), message: e.message })),
        duplicates: r.duplicates,
      })),
    };
  }

  /** Checks every row and holds the result as a batch. Nothing is written to the customer tables. */
  async validate(actor: AuthUser, buffer: Buffer, fileName: string, ctx: ReqCtx) {
    await this.purgeExpired();
    const { rows: parsed, ignoredColumns } = await this.excel.parse(buffer, fileName);

    const seen = {
      phone: new Map<string, number>(),
      aadhaar: new Map<string, number>(),
      pan: new Map<string, number>(),
    };
    const rows: StoredRow[] = [];
    for (const p of parsed) {
      const result = validateImportRow(p.values);
      if (result.errors.length || !result.steps) {
        rows.push({
          row: p.rowNumber,
          name: result.name,
          status: "error",
          values: p.values,
          errors: result.errors,
          duplicates: [],
        });
        continue;
      }
      const s = result.steps;
      const phone = s.basic.phone as string;
      const aadhaar = s.kyc.aadhaar as string;
      const pan = s.kyc.pan as string;
      const reasons: { code: string; name: string; reasons: string[] }[] = [];
      for (const [kind, val, label] of [
        ["phone", phone, "mobile number"],
        ["aadhaar", aadhaar, "Aadhaar"],
        ["pan", pan, "PAN"],
      ] as const) {
        const earlier = seen[kind].get(val);
        if (earlier) reasons.push({ code: "", name: `Row ${earlier} in this file`, reasons: [`Same ${label}`] });
        else seen[kind].set(val, p.rowNumber);
      }
      const existing = await this.customers.findDuplicates({
        phone,
        aadhaar,
        pan,
        name: result.name,
        dob: s.basic.dob as string,
      });
      for (const m of existing) reasons.push({ code: m.code, name: m.name, reasons: m.reasons });
      rows.push({
        row: p.rowNumber,
        name: result.name,
        status: reasons.length ? "duplicate" : "ready",
        values: p.values,
        errors: [],
        duplicates: reasons,
        steps: s,
      });
    }

    const counts = {
      ready: rows.filter((r) => r.status === "ready").length,
      errors: rows.filter((r) => r.status === "error").length,
      duplicates: rows.filter((r) => r.status === "duplicate").length,
    };
    const batch = await this.prisma.importBatch.create({
      data: {
        createdById: actor.id,
        fileName: fileName.slice(0, 120),
        totalRows: rows.length,
        readyRows: counts.ready,
        errorRows: counts.errors,
        duplicateRows: counts.duplicates,
        dataEnc: this.crypto.encrypt(JSON.stringify(rows)),
        expiresAt: new Date(Date.now() + RETENTION_MS),
      },
    });
    await this.audit.record(ctx, {
      action: "customer.import_validated",
      entity: "ImportBatch",
      entityId: batch.id,
      after: { fileName, total: rows.length, ...counts },
    });
    return this.report(batch.id, fileName, batch.expiresAt, rows, ignoredColumns);
  }

  /** Re-opens a held batch (for example after a page refresh) with the same report the upload returned. */
  async get(actor: AuthUser, id: string) {
    const b = await this.load(actor, id);
    // A finished import whose rows were all imported has nothing left to show: that is a result, not an error.
    if (!b.dataEnc && b.status === "IMPORTED")
      return {
        ...this.report(b.id, b.fileName, b.expiresAt, []),
        total: b.totalRows,
        status: b.status,
        imported: b.importedRows,
      };
    return {
      ...this.report(b.id, b.fileName, b.expiresAt, this.rowsOf(b)),
      status: b.status,
      imported: b.importedRows,
    };
  }

  /** The "rows to fix" workbook: same layout as the template, only the failed rows, with the reasons. */
  async errorFile(actor: AuthUser, id: string, which: "errors" | "duplicates") {
    const b = await this.load(actor, id);
    const rows = this.rowsOf(b).filter((r) => (which === "errors" ? r.status === "error" : r.status === "duplicate"));
    if (rows.length === 0)
      throw new BadRequestException({
        code: "NOTHING_TO_FIX",
        message:
          which === "errors"
            ? "There are no rows with errors in this upload."
            : "There are no possible duplicates in this upload.",
      });
    const out: ErrorRow[] = rows.map((r) => ({
      rowNumber: r.row,
      values: r.values,
      errors:
        r.status === "error"
          ? r.errors
          : [
              {
                column: "phone",
                message: `Possible duplicate: ${r.duplicates.map((d) => `${d.code ? `${d.name} (${d.code})` : d.name}: ${d.reasons.join(", ")}`).join("; ")}`,
              },
            ],
    }));
    return {
      buffer: await this.excel.build(out),
      fileName: `${which === "errors" ? "customers-to-fix" : "customers-possible-duplicates"}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    };
  }

  /**
   * Creates the ready rows (and, only if asked, the possible duplicates) as complete DRAFT customers. Consent is never
   * recorded on the customer's behalf, so every imported customer still needs consent before it can be activated.
   */
  async run(actor: AuthUser, id: string, includeDuplicates: boolean, ctx: ReqCtx) {
    const b = await this.load(actor, id);
    const claimed = await this.prisma.importBatch.updateMany({
      where: { id, status: "VALIDATED" },
      data: { status: "IMPORTING" },
    });
    if (claimed.count !== 1)
      throw new ConflictException({
        code: "ALREADY_IMPORTED",
        message:
          b.status === "IMPORTED"
            ? "This upload has already been imported."
            : `This upload can no longer be imported (${b.status.toLowerCase()}).`,
      });

    let rows: StoredRow[];
    try {
      rows = this.rowsOf(b);
    } catch (e) {
      await this.prisma.importBatch.update({ where: { id }, data: { status: "VALIDATED" } });
      throw e;
    }
    const codes: string[] = [];
    const left: StoredRow[] = [];
    let skippedDuplicates = 0;
    for (const r of rows) {
      const wanted = r.status === "ready" || (includeDuplicates && r.status === "duplicate");
      if (!wanted || !r.steps) {
        if (r.status === "duplicate") skippedDuplicates++;
        left.push(r);
        continue;
      }
      try {
        const c = await this.customers.create(actor, {}, ctx);
        for (const step of STEPS) await this.customers.saveStep(actor, c.id, step, r.steps[step], ctx);
        await this.audit.record(ctx, {
          action: "customer.bulk_imported",
          entity: "Customer",
          entityId: c.id,
          after: { batchId: id, row: r.row },
        });
        codes.push(c.code);
      } catch (e) {
        left.push({
          ...r,
          status: "error",
          errors: [
            { column: "firstName", message: `Could not be saved: ${e instanceof Error ? e.message : "unknown error"}` },
          ],
        });
      }
    }
    const failed = left.filter((r) => r.status === "error" && r.steps).length;
    const remaining = left.filter((r) => r.status !== "ready");
    await this.prisma.importBatch.update({
      where: { id },
      // Keep only what was NOT imported, so its "rows to fix" file stays available until the retention period ends.
      data: {
        status: "IMPORTED",
        importedRows: codes.length,
        createdCodes: codes,
        importedAt: new Date(),
        dataEnc: remaining.length ? this.crypto.encrypt(JSON.stringify(remaining)) : null,
        errorRows: remaining.filter((r) => r.status === "error").length,
        duplicateRows: remaining.filter((r) => r.status === "duplicate").length,
      },
    });
    await this.audit.record(ctx, {
      action: "customer.import",
      entity: "ImportBatch",
      entityId: id,
      after: { imported: codes.length, skippedDuplicates, failed, includeDuplicates },
    });
    return {
      imported: codes.length,
      codes,
      skippedErrors: remaining.filter((r) => r.status === "error").length - failed,
      skippedDuplicates,
      failed,
    };
  }

  async list(actor: AuthUser) {
    await this.purgeExpired();
    const rows = await this.prisma.importBatch.findMany({
      where: actor.roleLocked ? {} : { createdById: actor.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.createdById) } },
      select: { id: true, firstName: true, lastName: true },
    });
    return rows.map((b) => ({
      id: b.id,
      fileName: b.fileName,
      status: b.status,
      total: b.totalRows,
      ready: b.readyRows,
      errors: b.errorRows,
      duplicates: b.duplicateRows,
      imported: b.importedRows,
      createdAt: b.createdAt,
      expiresAt: b.expiresAt,
      by: (() => {
        const u = users.find((x) => x.id === b.createdById);
        return u ? `${u.firstName} ${u.lastName}`.trim() : "";
      })(),
      canImport: b.status === "VALIDATED" && !!b.dataEnc,
      errorFileAvailable: !!b.dataEnc && b.errorRows > 0,
      duplicateFileAvailable: !!b.dataEnc && b.duplicateRows > 0,
    }));
  }

  async discard(actor: AuthUser, id: string, ctx: ReqCtx) {
    const b = await this.load(actor, id);
    if (b.status === "IMPORTING") throw new ConflictException({ code: "BUSY", message: "This import is running" });
    await this.prisma.importBatch.update({
      where: { id },
      data: { status: b.status === "IMPORTED" ? "IMPORTED" : "DISCARDED", dataEnc: null },
    });
    await this.audit.record(ctx, { action: "customer.import_discarded", entity: "ImportBatch", entityId: id });
  }
}
