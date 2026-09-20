import { BadRequestException, Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  IMPORT_COLUMNS,
  IMPORT_EXTRA_HEADERS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  IMPORT_TEMPLATE_VERSION,
  cellText,
  headerLabel,
  matchHeaders,
  type ImportColumn,
} from "@jana/shared";
import { parseCsv, safeCell } from "../customers/csv";

const TEMPLATE_ID = "JANA-CUSTOMER-IMPORT";
const LAST_ROW = IMPORT_MAX_ROWS + 1;
const MAX_UNCOMPRESSED = 60 * 1024 * 1024;

/** A row as read from the file: the spreadsheet row number and each column's value (as plain text or number). */
export interface RawRow {
  rowNumber: number;
  values: Record<string, string | number | null>;
}

export interface ParsedFile {
  rows: RawRow[];
  ignoredColumns: string[];
}

export interface ErrorRow {
  rowNumber: number;
  values: Record<string, string | number | null>;
  errors: { column: string; message: string }[];
}

/** ExcelJS supports range-based validation (one entry for a whole column) but does not declare it in its types. */
type RangeValidations = { add(range: string, rule: Record<string, unknown>): void };
const validations = (ws: ExcelJS.Worksheet) => (ws as unknown as { dataValidations: RangeValidations }).dataValidations;

const INDIGO = "FF3F35C4";
const LIGHT = "FFE8E6FA";
const RED = "FFFDE2E2";
const argbColumn = (n: number) => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

@Injectable()
export class ExcelService {
  /* ---------------- writing ---------------- */

  /** The blank template, or (with `rows`) the "rows to fix" file: same layout plus the error columns. */
  async build(rows?: ErrorRow[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Jana Finance";
    wb.created = new Date();

    const help = wb.addWorksheet("Instructions", { properties: { tabColor: { argb: INDIGO } } });
    const ws = wb.addWorksheet("Customers", {
      views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
      properties: { tabColor: { argb: "FF15803D" } },
    });
    const lists = wb.addWorksheet("Lists", { state: "hidden" });
    const meta = wb.addWorksheet("_meta", { state: "veryHidden" });
    meta.getCell("A1").value = TEMPLATE_ID;
    meta.getCell("B1").value = IMPORT_TEMPLATE_VERSION;
    wb.views = [
      { x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: rows ? 1 : 0, visibility: "visible" },
    ];

    this.instructions(help, !!rows);
    this.sheet(ws, lists, rows);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private instructions(ws: ExcelJS.Worksheet, fixing: boolean) {
    ws.getColumn(1).width = 22;
    ws.getColumn(2).width = 26;
    ws.getColumn(3).width = 11;
    ws.getColumn(4).width = 62;
    ws.getColumn(5).width = 24;
    const title = ws.addRow([fixing ? "Rows to fix" : "Jana Finance: customer bulk upload"]);
    title.font = { bold: true, size: 16 };
    ws.addRow([]);
    const steps = fixing
      ? [
          "This file contains only the rows that could not be imported. The Errors column says what to correct.",
          "Correct the highlighted cells on the Customers sheet. You may leave the Errors columns as they are; they are ignored.",
          "Upload the file again in the app (Customers > Import). Rows that pass will be imported.",
        ]
      : [
          "Go to the Customers sheet and fill one customer per row, starting on row 2. Do not change, move or delete the header row.",
          "Columns marked * are mandatory. Grey-shaded headers are optional.",
          "Use the dropdowns where they appear. Type dates as DD/MM/YYYY. Type money as plain rupees (35000).",
          "Upload the file in the app (Customers > Import). Every row is checked first; nothing is saved until you confirm.",
          `A file can hold up to ${IMPORT_MAX_ROWS} customers. Photos and scanned documents are added later, on each customer.`,
          "Customers are created as drafts. Their consent must still be recorded in the app before they become active.",
        ];
    steps.forEach((s, i) => (ws.addRow([`${i + 1}.`, s]).getCell(2).alignment = { wrapText: false }));
    ws.addRow([]);
    const head = ws.addRow(["Section", "Column", "Required", "What to enter", "Example"]);
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INDIGO } }));
    for (const c of IMPORT_COLUMNS) {
      const what = c.kind === "list" ? `${c.help} Options: ${c.options!.map(([l]) => l).join(", ")}.` : c.help;
      const r = ws.addRow([c.section, c.header, c.required ? "Yes" : "No", what, c.example]);
      if (c.required) r.getCell(3).font = { bold: true, color: { argb: "FFB91C1C" } };
    }
  }

  private sheet(ws: ExcelJS.Worksheet, lists: ExcelJS.Worksheet, rows?: ErrorRow[]) {
    const cols = IMPORT_COLUMNS;
    ws.columns = [
      ...cols.map((c) => ({ key: c.key, width: c.width })),
      ...(rows
        ? [
            { key: "__row", width: 14 },
            { key: "__errors", width: 70 },
          ]
        : []),
    ];

    const header = ws.getRow(1);
    header.height = 34;
    cols.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.value = headerLabel(c);
      cell.font = { bold: true, color: { argb: c.required ? "FFFFFFFF" : "FF111827" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.required ? INDIGO : LIGHT } };
      cell.alignment = { vertical: "middle", wrapText: true };
      if (c.help) cell.note = { texts: [{ text: c.help }] };
      // Text columns must stay text, or Excel turns 12-digit numbers into 1.23E+11 and drops leading zeros.
      ws.getColumn(i + 1).numFmt =
        c.kind === "date" ? "dd/mm/yyyy" : c.kind === "money" ? "0.00" : c.kind === "int" ? "0" : "@";
    });
    if (rows)
      IMPORT_EXTRA_HEADERS.forEach((h, i) => {
        const cell = header.getCell(cols.length + 1 + i);
        cell.value = h;
        cell.font = { bold: true, color: { argb: "FF991B1B" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
      });

    // Dropdown sources live on a hidden sheet; each list column references its own range.
    let listCol = 0;
    cols.forEach((c, i) => {
      const letter = argbColumn(i + 1);
      const range = `${letter}2:${letter}${LAST_ROW}`;
      if (c.kind === "list") {
        listCol += 1;
        c.options!.forEach(([label], r) => (lists.getCell(r + 1, listCol).value = label));
        const ref = `Lists!$${argbColumn(listCol)}$1:$${argbColumn(listCol)}$${c.options!.length}`;
        validations(ws).add(range, {
          type: "list",
          allowBlank: !c.required,
          formulae: [ref],
          showErrorMessage: true,
          errorTitle: c.header,
          error: `Choose ${c.header} from the list.`,
        });
      } else if (c.kind === "date") {
        validations(ws).add(range, {
          type: "date",
          operator: "between",
          allowBlank: !c.required,
          formulae: [new Date(Date.UTC(1900, 0, 2)), new Date(Date.UTC(2100, 0, 1))],
          showErrorMessage: true,
          errorTitle: c.header,
          error: "Enter a date such as 15/05/1990.",
        });
      } else if (c.key === "cibilScore") {
        validations(ws).add(range, {
          type: "whole",
          operator: "between",
          allowBlank: !c.required,
          formulae: [300, 900],
          showErrorMessage: true,
          errorTitle: c.header,
          error: "Enter a whole number from 300 to 900.",
        });
      } else if (c.kind === "int") {
        validations(ws).add(range, {
          type: "whole",
          operator: "greaterThanOrEqual",
          allowBlank: true,
          formulae: [0],
          showErrorMessage: true,
          errorTitle: c.header,
          error: "Enter a whole number.",
        });
      } else if (c.kind === "money") {
        validations(ws).add(range, {
          type: "decimal",
          operator: "greaterThanOrEqual",
          allowBlank: !c.required,
          formulae: [0],
          showErrorMessage: true,
          errorTitle: c.header,
          error: "Enter an amount in rupees, for example 35000.",
        });
      }
    });

    rows?.forEach((r, n) => {
      const row = ws.getRow(n + 2);
      const bad = new Set(r.errors.map((e) => e.column));
      cols.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        cell.value = this.cellValue(c, r.values[c.key]);
        if (bad.has(c.key)) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
          cell.note = { texts: [{ text: r.errors.find((e) => e.column === c.key)!.message }] };
        }
      });
      row.getCell(cols.length + 1).value = r.rowNumber;
      row.getCell(cols.length + 2).value = r.errors
        .map((e) => `${IMPORT_COLUMNS.find((c) => c.key === e.column)?.header ?? e.column}: ${e.message}`)
        .join("\n");
      row.getCell(cols.length + 2).alignment = { wrapText: true, vertical: "top" };
    });
  }

  /** Writes a stored value back into the sheet: real dates for date columns, text for everything else that is text. */
  private cellValue(c: ImportColumn, v: string | number | null | undefined) {
    if (v === null || v === undefined || v === "") return null;
    if (c.kind === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00Z`);
    if (c.kind === "money" || c.kind === "int")
      return typeof v === "number" ? v : Number.isNaN(Number(v)) ? v : Number(v);
    return typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v;
  }

  /* ---------------- reading ---------------- */

  /** Reads an .xlsx (or .csv) upload. Throws a friendly 400 for anything that is not a usable customer sheet. */
  async parse(buffer: Buffer, fileName: string): Promise<ParsedFile> {
    if (buffer.length > IMPORT_MAX_BYTES)
      throw this.bad("FILE_TOO_LARGE", `The file is too large. The limit is ${IMPORT_MAX_BYTES / 1024 / 1024} MB.`);
    const ext = fileName.toLowerCase().split(".").pop();
    if (ext === "xlsm" || ext === "xlsb" || ext === "xls")
      throw this.bad(
        "UNSUPPORTED_FILE",
        "Save the file as an Excel Workbook (.xlsx) and upload that. Older .xls and macro-enabled files are not accepted.",
      );

    let table: unknown[][];
    if (ext === "csv") {
      table = parseCsv(buffer.toString("utf8"));
    } else if (ext === "xlsx") {
      table = await this.readWorkbook(buffer);
    } else {
      throw this.bad("UNSUPPORTED_FILE", "Upload the Excel template (.xlsx). CSV files are accepted too.");
    }

    // Header row: normally row 1, but tolerate a title line or two above it.
    let headerAt = -1;
    for (let i = 0; i < Math.min(table.length, 5); i++) {
      if (matchHeaders(table[i]!.map((c) => cellText(c))).index.size >= 5) {
        headerAt = i;
        break;
      }
    }
    if (headerAt < 0)
      throw this.bad(
        "NOT_THE_TEMPLATE",
        "This does not look like the customer template. Download the template from the app and copy your data into it.",
      );
    const match = matchHeaders(table[headerAt]!.map((c) => cellText(c)));
    if (match.missingRequired.length)
      throw this.bad(
        "MISSING_COLUMNS",
        `These required columns are missing: ${match.missingRequired.join(", ")}. Use the latest template and do not rename or delete headers.`,
      );

    const rows: RawRow[] = [];
    for (let i = headerAt + 1; i < table.length; i++) {
      const line = table[i]!;
      const values: RawRow["values"] = {};
      let any = false;
      for (const [key, idx] of match.index) {
        const cell = line[idx];
        const isBlank = cell === null || cell === undefined || (typeof cell === "string" && cell.trim() === "");
        if (!isBlank) any = true;
        values[key] = isBlank ? null : this.plain(cell);
      }
      if (any) rows.push({ rowNumber: i + 1, values });
      if (rows.length > IMPORT_MAX_ROWS)
        throw this.bad(
          "TOO_MANY_ROWS",
          `A file can hold at most ${IMPORT_MAX_ROWS} customers. Split it into smaller files.`,
        );
    }
    if (rows.length === 0)
      throw this.bad(
        "EMPTY_FILE",
        "There are no customer rows in the file. Fill in the rows below the header and try again.",
      );
    return { rows, ignoredColumns: match.ignored };
  }

  /** Cell -> a JSON-safe value: dates become ISO text, rich text becomes plain text. */
  private plain(cell: unknown): string | number {
    if (typeof cell === "number") return cell;
    if (cell instanceof Date) return cell.toISOString().slice(0, 10);
    return cellText(cell);
  }

  private async readWorkbook(buffer: Buffer): Promise<unknown[][]> {
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b)
      throw this.bad("UNSUPPORTED_FILE", "That file is not an Excel workbook. Save it as .xlsx and try again.");

    // Refuse zip bombs and macro workbooks before parsing anything.
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buffer);
    } catch {
      throw this.bad("UNSUPPORTED_FILE", "That file could not be opened. Save it again as .xlsx and try again.");
    }
    const names = Object.keys(zip.files);
    if (names.some((n) => /vbaProject\.bin$/i.test(n)))
      throw this.bad("UNSUPPORTED_FILE", "Files with macros are not accepted. Save a plain .xlsx and try again.");
    if (!names.includes("xl/workbook.xml")) throw this.bad("UNSUPPORTED_FILE", "That file is not an Excel workbook.");
    const total = Object.values(zip.files).reduce(
      (s, f) => s + ((f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0),
      0,
    );
    if (total > MAX_UNCOMPRESSED)
      throw this.bad(
        "FILE_TOO_LARGE",
        "The workbook is too large to import. Remove unused rows and columns, or split it.",
      );

    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw this.bad(
        "UNSUPPORTED_FILE",
        "That file could not be read as an Excel workbook. Save it again as .xlsx and try again.",
      );
    }

    // Old or altered template? The hidden marker sheet carries the version.
    const meta = wb.getWorksheet("_meta");
    if (
      meta &&
      cellText(meta.getCell("A1").value) === TEMPLATE_ID &&
      cellText(meta.getCell("B1").value) !== IMPORT_TEMPLATE_VERSION
    ) {
      throw this.bad(
        "OLD_TEMPLATE",
        "This file was made from an older template. Download the latest template and copy your data into it.",
      );
    }
    const ws =
      wb.getWorksheet("Customers") ??
      wb.worksheets.find((w) => w.state === "visible" && w.name !== "Instructions") ??
      wb.worksheets[0];
    if (!ws) throw this.bad("NOT_THE_TEMPLATE", "The workbook has no sheets.");
    if (ws.rowCount > IMPORT_MAX_ROWS + 200) {
      // Rows may be formatted but empty; only count if real data would exceed the limit (checked while reading).
    }
    const width = Math.min(ws.columnCount, 120);
    const table: unknown[][] = [];
    const limit = Math.min(ws.rowCount, IMPORT_MAX_ROWS + 500);
    for (let r = 1; r <= limit; r++) {
      const row = ws.getRow(r);
      const line: unknown[] = [];
      for (let c = 1; c <= width; c++) line.push(this.excelValue(row.getCell(c).value));
      table.push(line);
    }
    return table;
  }

  /** ExcelJS cell values include formula and hyperlink objects; keep only what the user sees. */
  private excelValue(v: ExcelJS.CellValue): unknown {
    if (v === null || v === undefined) return null;
    if (v instanceof Date || typeof v === "number" || typeof v === "string") return v;
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    const o = v as unknown as { result?: unknown; richText?: unknown; text?: unknown; error?: unknown };
    if (o.error) return String(o.error);
    if (o.result !== undefined) return o.result instanceof Date ? o.result : (o.result as string | number);
    return cellText(o);
  }

  /** CSV-safe text for a downloaded row (kept for parity with the export module). */
  safe(v: unknown) {
    return safeCell(v);
  }

  private bad(code: string, message: string) {
    return new BadRequestException({ code, message });
  }
}
