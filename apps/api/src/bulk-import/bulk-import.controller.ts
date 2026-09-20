import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import { IMPORT_MAX_BYTES } from "@jana/shared";
import { CurrentUser, Ctx, RequirePermissions, type AuthUser, type ReqCtx } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { BulkImportService } from "./bulk-import.service";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const runSchema = z.object({ includeDuplicates: z.boolean().default(false) });
const whichSchema = z.object({ rows: z.enum(["errors", "duplicates"]).default("errors") });
const uuid = new ParseUUIDPipe();

/** Declared before CustomersController so `/customers/import/...` is never mistaken for `/customers/:id`. */
@Controller("customers/import")
export class BulkImportController {
  constructor(private imports: BulkImportService) {}

  @Get("template")
  @RequirePermissions("customer:import")
  async template(@Res() res: Response) {
    res.set({
      "Content-Type": XLSX,
      "Content-Disposition": 'attachment; filename="jana-customer-import-template.xlsx"',
      "Cache-Control": "no-store",
    });
    res.send(await this.imports.template());
  }

  /** Step 1: check every row. Nothing is saved as a customer. */
  @Post("validate")
  @HttpCode(200)
  @RequirePermissions("customer:import", "customer:create", "kyc:upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: IMPORT_MAX_BYTES, files: 1 } }))
  validate(@CurrentUser() actor: AuthUser, @UploadedFile() file: Express.Multer.File | undefined, @Ctx() ctx: ReqCtx) {
    if (!file) throw new BadRequestException({ code: "NO_FILE", message: "Attach the filled template" });
    return this.imports.validate(actor, file.buffer, file.originalname, ctx);
  }

  @Get("batches")
  @RequirePermissions("customer:import")
  list(@CurrentUser() actor: AuthUser) {
    return this.imports.list(actor);
  }

  @Get("batches/:id")
  @RequirePermissions("customer:import")
  get(@Param("id", uuid) id: string, @CurrentUser() actor: AuthUser) {
    return this.imports.get(actor, id);
  }

  /** The rows that failed (or the possible duplicates), in the template layout, to correct and upload again. */
  @Get("batches/:id/errors")
  @RequirePermissions("customer:import")
  async errors(
    @Param("id", uuid) id: string,
    @Query(new ZodPipe(whichSchema)) q: { rows: "errors" | "duplicates" },
    @CurrentUser() actor: AuthUser,
    @Res() res: Response,
  ) {
    const f = await this.imports.errorFile(actor, id, q.rows);
    res.set({
      "Content-Type": XLSX,
      "Content-Disposition": `attachment; filename="${f.fileName}"`,
      "Cache-Control": "no-store",
    });
    res.send(f.buffer);
  }

  /** Step 2: import the checked rows as drafts. */
  @Post("batches/:id/run")
  @HttpCode(200)
  @RequirePermissions("customer:import", "customer:create", "kyc:upload")
  run(
    @Param("id", uuid) id: string,
    @Body(new ZodPipe(runSchema)) body: { includeDuplicates: boolean },
    @CurrentUser() actor: AuthUser,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.imports.run(actor, id, body.includeDuplicates, ctx);
  }

  @Delete("batches/:id")
  @HttpCode(204)
  @RequirePermissions("customer:import")
  async discard(@Param("id", uuid) id: string, @CurrentUser() actor: AuthUser, @Ctx() ctx: ReqCtx) {
    await this.imports.discard(actor, id, ctx);
  }
}
