import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import {
  approveLoanSchema,
  collateralSchema,
  createLoanSchema,
  disburseLoanSchema,
  interestDueQuerySchema,
  loanListQuerySchema,
  loanPaymentSchema,
  loanProductSchema,
  rejectLoanSchema,
  releaseCollateralSchema,
  updateLoanSchema,
  type CreateLoanInput,
  type LoanPaymentInput,
  type LoanProductInput,
} from "@jana/shared";
import { CurrentUser, Ctx, RequirePermissions, type AuthUser, type ReqCtx } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { MAX_FILE_BYTES } from "../customers/kyc.service";
import { LoanPaymentsService } from "./loan-payments.service";
import { LoansService } from "./loans.service";

const uuid = new ParseUUIDPipe();
const previewQuery = z.object({
  customerId: z.string().uuid(),
  productId: z.string().uuid(),
  principalPaise: z.coerce.number().int().positive(),
  monthlyRateBp: z.coerce.number().int().min(1).max(1000),
});
const asOfQuery = z.object({
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
const paging = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
const reverseSchema = z.object({ reason: z.string().trim().min(3).max(300) });

@Controller("loan-products")
export class LoanProductsController {
  constructor(private loans: LoansService) {}

  @Get()
  @RequirePermissions("loan:view")
  list(@Query("all") all?: string) {
    return this.loans.listProducts(all === "true");
  }

  @Post()
  @RequirePermissions("loan:edit")
  create(@Body(new ZodPipe(loanProductSchema)) body: LoanProductInput, @Ctx() ctx: ReqCtx) {
    return this.loans.createProduct(body, ctx);
  }

  @Patch(":id")
  @RequirePermissions("loan:edit")
  update(
    @Param("id", uuid) id: string,
    @Body(new ZodPipe(loanProductSchema)) body: LoanProductInput,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.loans.updateProduct(id, body, ctx);
  }
}

@Controller("loans")
export class LoansController {
  constructor(
    private loans: LoansService,
    private pay: LoanPaymentsService,
  ) {}

  /* ---- static routes first, so they are never mistaken for :id ---- */

  @Get()
  @RequirePermissions("loan:view")
  list(@Query(new ZodPipe(loanListQuerySchema)) q: z.infer<typeof loanListQuerySchema>) {
    return this.loans.list(q);
  }

  @Get("stats")
  @RequirePermissions("loan:view")
  stats() {
    return this.loans.stats();
  }

  @Get("interest-due")
  @RequirePermissions("loan:view")
  interestDue(
    @Query(new ZodPipe(interestDueQuerySchema.merge(paging)))
    q: z.infer<typeof interestDueQuerySchema> & z.infer<typeof paging>,
  ) {
    return this.loans.interestDue(q, q.page, q.pageSize);
  }

  @Get("preview")
  @RequirePermissions("loan:create")
  preview(@Query(new ZodPipe(previewQuery)) q: z.infer<typeof previewQuery>) {
    return this.loans.preview(q.customerId, q.productId, q.principalPaise, q.monthlyRateBp);
  }

  @Get("payments/:id")
  @RequirePermissions("loan:view")
  receipt(@Param("id", uuid) id: string) {
    return this.pay.receipt(id);
  }

  @Post("payments/:id/reverse")
  @HttpCode(200)
  @RequirePermissions("payment:reverse")
  reverse(
    @Param("id", uuid) id: string,
    @Body(new ZodPipe(reverseSchema)) body: { reason: string },
    @CurrentUser() actor: AuthUser,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.pay.reverse(id, body.reason, actor, ctx);
  }

  @Get("files/:fileId/url")
  @RequirePermissions("loan:view")
  photoUrl(@Param("fileId", uuid) fileId: string, @Ctx() ctx: ReqCtx) {
    return this.loans.photoUrl(fileId, ctx);
  }

  @Post()
  @RequirePermissions("loan:create")
  create(
    @Body(new ZodPipe(createLoanSchema)) body: CreateLoanInput,
    @CurrentUser() actor: AuthUser,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.loans.create(body, actor, ctx);
  }

  /* ---- one loan ---- */

  @Get(":id")
  @RequirePermissions("loan:view")
  get(@Param("id", uuid) id: string, @Query(new ZodPipe(asOfQuery)) q: z.infer<typeof asOfQuery>) {
    return this.loans.get(id, q.asOf);
  }

  @Patch(":id")
  @RequirePermissions("loan:create")
  update(
    @Param("id", uuid) id: string,
    @Body(new ZodPipe(updateLoanSchema)) body: Partial<CreateLoanInput>,
    @CurrentUser() actor: AuthUser,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.loans.update(id, body, actor, ctx);
  }

  @Post(":id/approve")
  @HttpCode(200)
  @RequirePermissions("loan:approve")
  approve(
    @Param("id", uuid) id: string,
    @Body(new ZodPipe(approveLoanSchema)) body: { overrideReason?: string },
    @CurrentUser() actor: AuthUser,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.loans.approve(id, body.overrideReason, actor, ctx);
  }

  @Post(":id/reject")
  @HttpCode(200)
  @RequirePermissions("loan:approve")
  reject(
    @Param("id", uuid) id: string,
    @Body(new ZodPipe(rejectLoanSchema)) body: { reason: string },
    @CurrentUser() actor: AuthUser,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.loans.reject(id, body.reason, actor, ctx);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermissions("loan:edit")
  cancel(@Param("id", uuid) id: string, @Ctx() ctx: ReqCtx) {
    return this.loans.cancel(id, ctx);
  }

  @Post(":id/disburse")
  @HttpCode(200)
  @RequirePermissions("loan:disburse")
  disburse(
    @Param("id", uuid) id: string,
    @Body(new ZodPipe(disburseLoanSchema)) body: { mode: string; reference?: string; disbursedOn?: string },
    @CurrentUser() actor: AuthUser,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.loans.disburse(id, body, actor, ctx);
  }

  @Get(":id/payoff")
  @RequirePermissions("loan:view")
  payoff(@Param("id", uuid) id: string, @Query(new ZodPipe(asOfQuery)) q: z.infer<typeof asOfQuery>) {
    return this.pay.payoff(id, q.asOf);
  }

  @Post(":id/payments")
  @RequirePermissions("payment:create")
  receive(
    @Param("id", uuid) id: string,
    @Body(new ZodPipe(loanPaymentSchema)) body: LoanPaymentInput,
    @Headers("idempotency-key") key: string | undefined,
    @CurrentUser() actor: AuthUser,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.pay.receive(id, body, key, actor, ctx);
  }

  /* ---- collateral ---- */

  @Post(":id/collateral")
  @RequirePermissions("loan:edit")
  addCollateral(
    @Param("id", uuid) id: string,
    @Body(new ZodPipe(collateralSchema)) body: z.infer<typeof collateralSchema>,
    @CurrentUser() actor: AuthUser,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.loans.addCollateral(id, body, actor, ctx);
  }

  @Post(":id/collateral/:cid/release")
  @HttpCode(200)
  @RequirePermissions("loan:edit")
  release(
    @Param("id", uuid) id: string,
    @Param("cid", uuid) cid: string,
    @Body(new ZodPipe(releaseCollateralSchema)) body: { note?: string },
    @Ctx() ctx: ReqCtx,
  ) {
    return this.loans.releaseCollateral(id, cid, body.note, ctx);
  }

  @Delete(":id/collateral/:cid")
  @RequirePermissions("loan:edit")
  removeCollateral(@Param("id", uuid) id: string, @Param("cid", uuid) cid: string, @Ctx() ctx: ReqCtx) {
    return this.loans.removeCollateral(id, cid, ctx);
  }

  @Post(":id/collateral/:cid/photos")
  @RequirePermissions("loan:edit")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  addPhoto(
    @Param("id", uuid) id: string,
    @Param("cid", uuid) cid: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("label") label: string | undefined,
    @CurrentUser() actor: AuthUser,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.loans.addCollateralPhoto(id, cid, file, label ?? "", actor, ctx);
  }

  @Delete(":id/photos/:fileId")
  @RequirePermissions("loan:edit")
  removePhoto(@Param("id", uuid) id: string, @Param("fileId", uuid) fileId: string, @Ctx() ctx: ReqCtx) {
    return this.loans.removeCollateralPhoto(id, fileId, ctx);
  }
}
