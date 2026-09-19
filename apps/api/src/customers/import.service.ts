import { BadRequestException, Injectable } from "@nestjs/common";
import { draftStepSchema, employmentStepSchema, type WizardStep } from "@jana/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser, ReqCtx } from "../common/decorators";
import { parseCsv, toCsv } from "./csv";
import { CustomersService } from "./customers.service";

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 1000;

const COLUMNS = [
  "firstName",
  "lastName",
  "gender",
  "dob",
  "phone",
  "altPhone",
  "email",
  "maritalStatus",
  "currentAddress",
  "permanentAddress",
  "state",
  "district",
  "pincode",
  "residenceType",
  "aadhaar",
  "pan",
  "occupationType",
  "monthlyIncome",
  "cibilScore",
] as const;
type Col = (typeof COLUMNS)[number];

const STEP_OF: Record<string, WizardStep> = {
  firstName: "basic",
  lastName: "basic",
  gender: "basic",
  dob: "basic",
  phone: "basic",
  altPhone: "basic",
  email: "basic",
  maritalStatus: "basic",
  currentAddress: "address",
  permanentAddress: "address",
  state: "address",
  district: "address",
  pincode: "address",
  residenceType: "address",
  aadhaar: "kyc",
  pan: "kyc",
  occupationType: "employment",
  monthlyIncome: "employment",
  cibilScore: "evaluation",
};

export interface RowReport {
  row: number;
  name: string;
  status: "ok" | "duplicate" | "error";
  messages: string[];
}

/** "25/12/1990" or "1990-12-25" -> "1990-12-25". Anything else is passed through and fails validation. */
function normaliseDate(v: string) {
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v.trim());
  return m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : v.trim();
}

@Injectable()
export class ImportService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private customers: CustomersService,
  ) {}

  template() {
    return toCsv([
      [...COLUMNS],
      [
        "Anitha",
        "Raman",
        "FEMALE",
        "15/05/1990",
        "9876543210",
        "",
        "anitha@example.com",
        "MARRIED",
        "12 Gandhi Road",
        "12 Gandhi Road",
        "Tamil Nadu",
        "Kanchipuram",
        "631501",
        "OWN",
        "",
        "",
        "SALARIED",
        "35000",
        "720",
      ],
    ]);
  }

  /**
   * Imports customers from CSV as DRAFTS. They still need references, bank details and the customer's own consent, so
   * they are never activated automatically. Use `dryRun` to get the full validation report without writing anything.
   */
  async run(actor: AuthUser, buffer: Buffer, dryRun: boolean, ctx: ReqCtx) {
    if (buffer.length > MAX_IMPORT_BYTES)
      throw new BadRequestException({ code: "FILE_TOO_LARGE", message: "Import files can be at most 2 MB" });
    const table = parseCsv(buffer.toString("utf8"));
    if (table.length < 2)
      throw new BadRequestException({
        code: "EMPTY_FILE",
        message: "The file needs a header row and at least one customer",
      });
    if (table.length - 1 > MAX_ROWS)
      throw new BadRequestException({ code: "TOO_MANY_ROWS", message: `At most ${MAX_ROWS} customers per import` });

    const header = table[0]!.map((h) => h.trim());
    const index = new Map<Col, number>();
    const ignored: string[] = [];
    header.forEach((h, i) => {
      const col = COLUMNS.find((c) => c.toLowerCase() === h.toLowerCase());
      if (col) index.set(col, i);
      else if (h) ignored.push(h);
    });
    if (!index.has("firstName") || !index.has("phone"))
      throw new BadRequestException({
        code: "MISSING_COLUMNS",
        message: "The header must include at least firstName and phone. Download the template for the exact columns.",
      });

    const seen = { phone: new Set<string>(), aadhaar: new Set<string>(), pan: new Set<string>() };
    const report: RowReport[] = [];
    const prepared: { row: number; steps: [WizardStep, Record<string, unknown>][] }[] = [];

    for (let r = 1; r < table.length; r++) {
      const cells = table[r]!;
      const get = (c: Col) => (index.has(c) ? (cells[index.get(c)!] ?? "").trim() : "");
      const name = `${get("firstName")} ${get("lastName")}`.trim();
      const messages: string[] = [];
      const byStep = new Map<WizardStep, Record<string, unknown>>();

      for (const col of COLUMNS) {
        const raw = get(col);
        if (raw === "") continue;
        const step = STEP_OF[col]!;
        const target = byStep.get(step) ?? {};
        if (col === "dob") target.dob = normaliseDate(raw);
        else if (col === "gender" || col === "maritalStatus" || col === "residenceType" || col === "occupationType")
          target[col] = raw.toUpperCase().replace(/[\s-]+/g, "_");
        else if (col === "monthlyIncome") {
          if (!/^\d+(\.\d{1,2})?$/.test(raw.replace(/,/g, "")))
            messages.push("monthlyIncome: use a number such as 35000");
          else target.monthlyIncomePaise = Math.round(Number(raw.replace(/,/g, "")) * 100);
        } else if (col === "cibilScore") target.cibilScore = Number(raw);
        else target[col] = raw;
        byStep.set(step, target);
      }
      if (byStep.has("evaluation")) byStep.get("evaluation")!.existingLoans = 0;

      // Validate every step with the same rules as the wizard's draft save.
      for (const [step, body] of byStep) {
        const schema = step === "employment" ? employmentStepSchema.partial() : draftStepSchema(step);
        const parsed = schema.safeParse(body);
        if (!parsed.success)
          for (const i of parsed.error.issues) messages.push(`${i.path.join(".") || step}: ${i.message}`);
      }
      if (!get("firstName")) messages.push("firstName: required");
      if (!get("phone")) messages.push("phone: required");

      if (messages.length === 0) {
        const phone = (byStep.get("basic")?.phone as string | undefined)?.replace(/\D/g, "").slice(-10);
        const dupReasons: string[] = [];
        for (const [kind, val] of [
          ["phone", phone],
          ["aadhaar", (byStep.get("kyc")?.aadhaar as string | undefined)?.replace(/\s/g, "")],
          ["pan", (byStep.get("kyc")?.pan as string | undefined)?.toUpperCase()],
        ] as const) {
          if (!val) continue;
          if (seen[kind].has(val)) dupReasons.push(`${kind} repeated in this file`);
          seen[kind].add(val);
        }
        const existing = await this.customers.findDuplicates({
          phone,
          aadhaar: byStep.get("kyc")?.aadhaar as string | undefined,
          pan: byStep.get("kyc")?.pan as string | undefined,
          name: name || undefined,
          dob: byStep.get("basic")?.dob as string | undefined,
        });
        for (const m of existing) dupReasons.push(`${m.reasons.join(", ")}: ${m.name} (${m.code})`);
        if (dupReasons.length) {
          report.push({ row: r + 1, name, status: "duplicate", messages: dupReasons });
          continue;
        }
        report.push({ row: r + 1, name, status: "ok", messages: [] });
        prepared.push({ row: r + 1, steps: [...byStep.entries()] });
      } else {
        report.push({ row: r + 1, name, status: "error", messages });
      }
    }

    let created = 0;
    if (!dryRun) {
      for (const p of prepared) {
        try {
          const c = await this.customers.create(actor, {}, ctx);
          for (const [step, body] of p.steps) await this.customers.saveStep(actor, c.id, step, body, ctx);
          created++;
        } catch (e) {
          const entry = report.find((x) => x.row === p.row)!;
          entry.status = "error";
          entry.messages = [e instanceof Error ? e.message : "Could not save this row"];
        }
      }
    }
    const summary = {
      total: report.length,
      ok: report.filter((r) => r.status === "ok").length,
      duplicates: report.filter((r) => r.status === "duplicate").length,
      errors: report.filter((r) => r.status === "error").length,
    };
    await this.audit.record(ctx, {
      action: dryRun ? "customer.import_dry_run" : "customer.import",
      entity: "Customer",
      after: { ...summary, created },
    });
    return { dryRun, ...summary, created, ignoredColumns: ignored, rows: report };
  }
}
