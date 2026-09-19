import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import {
  KYC_DOC_TYPES,
  WIZARD_STEPS,
  createCustomerSchema,
  createNoteSchema,
  setTagsSchema,
  setWatchSchema,
  customerListQuerySchema,
  duplicateCheckSchema,
  rejectDocSchema,
  revealSchema,
  setCustomerStatusSchema,
  submitCustomerSchema,
  type CustomerListQuery,
  type WizardStep,
} from "@jana/shared";
import type { KycDocType } from "@prisma/client";
import { CurrentUser, Ctx, Public, RequirePermissions, type AuthUser, type ReqCtx } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { StorageService } from "../storage/storage.service";
import { CustomersService } from "./customers.service";
import { KycService, MAX_FILE_BYTES } from "./kyc.service";
import { ImportService, MAX_IMPORT_BYTES } from "./import.service";

@Controller("customers")
export class CustomersController {
  constructor(
    private customers: CustomersService,
    private kyc: KycService,
    private importer: ImportService,
  ) {}

  @Get("stats")
  @RequirePermissions("customer:view")
  stats() {
    return this.customers.stats();
  }

  /** Open follow-up tasks due today or earlier, across all customers. */
  @Get("follow-ups")
  @RequirePermissions("customer:view")
  followUps(@Query("upTo") upTo?: string) {
    return this.customers.followUpsDue(upTo && /^\d{4}-\d{2}-\d{2}$/.test(upTo) ? upTo : undefined);
  }

  @Get("export")
  @RequirePermissions("customer:export")
  async export(
    @Query(new ZodPipe(customerListQuerySchema)) q: CustomerListQuery,
    @Ctx() ctx: ReqCtx,
    @Res() res: Response,
  ) {
    const csv = await this.customers.exportCsv(q, ctx);
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    });
    res.send("\uFEFF" + csv);
  }

  @Get("import/template")
  @RequirePermissions("customer:import")
  importTemplate(@Res() res: Response) {
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="customer-import-template.csv"',
    });
    res.send(this.importer.template());
  }

  /** Imports customers as drafts. Send dryRun=true to get the validation report without saving anything. */
  @Post("import")
  @HttpCode(200)
  @RequirePermissions("customer:import", "customer:create")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } }))
  import(
    @CurrentUser() actor: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("dryRun") dryRun: string | undefined,
    @Ctx() ctx: ReqCtx,
  ) {
    if (!file) throw new BadRequestException({ code: "NO_FILE", message: "Attach a CSV file" });
    return this.importer.run(actor, file.buffer, dryRun !== "false", ctx);
  }

  @Get()
  @RequirePermissions("customer:view")
  list(@Query(new ZodPipe(customerListQuerySchema)) q: CustomerListQuery) {
    return this.customers.list(q);
  }

  @Post("duplicates/check")
  @HttpCode(200)
  @RequirePermissions("customer:view")
  async duplicates(@Body(new ZodPipe(duplicateCheckSchema)) body: Parameters<CustomersService["findDuplicates"]>[0]) {
    return { matches: await this.customers.findDuplicates(body) };
  }

  @Post()
  @RequirePermissions("customer:create")
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodPipe(createCustomerSchema)) body: { firstName?: string; lastName?: string; phone?: string },
    @Ctx() ctx: ReqCtx,
  ) {
    return this.customers.create(actor, body, ctx);
  }

  @Get(":id")
  @RequirePermissions("customer:view")
  get(@CurrentUser() actor: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.customers.get(actor, id);
  }

  @Get(":id/activity")
  @RequirePermissions("customer:view")
  activity(@Param("id", ParseUUIDPipe) id: string) {
    return this.customers.activity(id);
  }

  @Patch(":id/steps/:step")
  @RequirePermissions("customer:edit")
  saveStep(
    @CurrentUser() actor: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("step", new ZodPipe(z.enum(WIZARD_STEPS))) step: WizardStep,
    @Body() body: unknown,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.customers.saveStep(actor, id, step, body, ctx);
  }

  @Post(":id/submit")
  @HttpCode(200)
  @RequirePermissions("customer:create")
  submit(
    @CurrentUser() actor: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(submitCustomerSchema)) body: { acknowledgeDuplicates: boolean },
    @Ctx() ctx: ReqCtx,
  ) {
    return this.customers.submit(actor, id, body.acknowledgeDuplicates, ctx);
  }

  @Post(":id/status")
  @HttpCode(200)
  @RequirePermissions("customer:edit")
  setStatus(
    @CurrentUser() actor: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(setCustomerStatusSchema)) body: { status: "ACTIVE" | "INACTIVE" },
    @Ctx() ctx: ReqCtx,
  ) {
    return this.customers.setStatus(actor, id, body.status, ctx);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("customer:delete")
  async remove(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: ReqCtx) {
    await this.customers.remove(id, ctx);
  }

  @Post(":id/reveal")
  @HttpCode(200)
  @RequirePermissions("customer:view", "kyc:reveal_sensitive")
  reveal(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(revealSchema)) body: { field: Parameters<CustomersService["reveal"]>[1] },
    @Ctx() ctx: ReqCtx,
  ) {
    return this.customers.reveal(id, body.field, ctx);
  }

  @Get(":id/notes")
  @RequirePermissions("customer:view")
  notes(@Param("id", ParseUUIDPipe) id: string) {
    return this.customers.listNotes(id);
  }

  @Post(":id/notes")
  @RequirePermissions("customer:edit")
  addNote(
    @CurrentUser() actor: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(createNoteSchema)) body: Parameters<CustomersService["addNote"]>[2],
    @Ctx() ctx: ReqCtx,
  ) {
    return this.customers.addNote(actor, id, body, ctx);
  }

  @Post(":id/notes/:noteId/complete")
  @HttpCode(200)
  @RequirePermissions("customer:edit")
  completeNote(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("noteId", ParseUUIDPipe) noteId: string,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.customers.completeNote(id, noteId, ctx);
  }

  @Patch(":id/tags")
  @RequirePermissions("customer:edit")
  setTags(
    @CurrentUser() actor: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(setTagsSchema)) body: { tags: string[] },
    @Ctx() ctx: ReqCtx,
  ) {
    return this.customers.setTags(actor, id, body.tags, ctx);
  }

  @Post(":id/watch")
  @HttpCode(200)
  @RequirePermissions("customer:blacklist")
  setWatch(
    @CurrentUser() actor: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(setWatchSchema)) body: { status: "NONE" | "WATCHLIST" | "BLACKLIST"; reason?: string },
    @Ctx() ctx: ReqCtx,
  ) {
    return this.customers.setWatch(actor, id, body.status, body.reason, ctx);
  }

  /* ---- KYC documents ---- */

  @Post(":id/documents/:type/files")
  @RequirePermissions("kyc:upload")
  // No `storage` option: multer keeps uploads in memory, which is what we want (validated, then written by StorageService).
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  upload(
    @CurrentUser() actor: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("type", new ZodPipe(z.enum(KYC_DOC_TYPES))) type: KycDocType,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("label") label: string | undefined,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.kyc.uploadFile(actor, id, type, file, label ?? "", ctx);
  }

  @Delete(":id/documents/files/:fileId")
  @RequirePermissions("kyc:upload")
  deleteFile(
    @CurrentUser() actor: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("fileId", ParseUUIDPipe) fileId: string,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.kyc.deleteFile(actor, id, fileId, ctx);
  }

  @Post(":id/documents/:type/verify")
  @HttpCode(200)
  @RequirePermissions("kyc:verify")
  verify(
    @CurrentUser() actor: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("type", new ZodPipe(z.enum(KYC_DOC_TYPES))) type: KycDocType,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.kyc.verify(actor, id, type, ctx);
  }

  @Post(":id/documents/:type/reject")
  @HttpCode(200)
  @RequirePermissions("kyc:reject")
  reject(
    @CurrentUser() actor: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("type", new ZodPipe(z.enum(KYC_DOC_TYPES))) type: KycDocType,
    @Body(new ZodPipe(rejectDocSchema)) body: { reason: string },
    @Ctx() ctx: ReqCtx,
  ) {
    return this.kyc.reject(actor, id, type, body.reason, ctx);
  }
}

@Controller("files")
export class FilesController {
  constructor(
    private kyc: KycService,
    private storage: StorageService,
  ) {}

  @Get(":id/url")
  @RequirePermissions("kyc:view")
  url(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: ReqCtx) {
    return this.kyc.fileUrl(id, ctx);
  }

  /** Authenticated by the URL signature (so <img> tags work), never public: links expire after ~60 seconds. */
  @Public()
  @Get(":id/content")
  async content(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("e") e: string,
    @Query("s") s: string,
    @Res() res: Response,
  ) {
    if (!this.storage.verify(id, Number(e), s ?? "")) {
      res.status(403).json({ code: "LINK_EXPIRED", message: "This link is invalid or has expired" });
      return;
    }
    const { meta, data } = await this.kyc.readFile(id);
    res.set({
      "Content-Type": meta.mimeType,
      "Content-Length": String(data.length),
      "Content-Disposition": `inline; filename="${meta.id}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
    res.send(data);
  }
}
