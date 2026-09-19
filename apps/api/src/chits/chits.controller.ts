import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import {
  approvePayoutSchema,
  bidSchema,
  cancelChitSchema,
  chitListQuerySchema,
  closeAuctionSchema,
  createChitGroupSchema,
  enrolSchema,
  payPayoutSchema,
  paymentSchema,
  reversePaymentSchema,
  transferSchema,
  updateChitGroupSchema,
  waitlistSchema,
  type CreateChitGroupInput,
} from "@jana/shared";
import type { PayMode } from "@prisma/client";
import { CurrentUser, Ctx, RequirePermissions, type AuthUser, type ReqCtx } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { ChitCollectionService } from "./chit-collection.service";
import { ChitService } from "./chit.service";

const payoutQuery = z.object({
  groupId: z.string().uuid().optional(),
  status: z.enum(["PENDING", "APPROVED", "PAID"]).optional(),
});
const asOfQuery = z.object({
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
const uuid = new ParseUUIDPipe();

@Controller("chits")
export class ChitsController {
  constructor(
    private chits: ChitService,
    private collect: ChitCollectionService,
  ) {}

  /* ---- static routes first, so they are never mistaken for :id ---- */

  @Get("payouts")
  @RequirePermissions("chit:view")
  payouts(@Query(new ZodPipe(payoutQuery)) q: z.infer<typeof payoutQuery>) {
    return this.collect.listPayouts(q);
  }

  @Post("payouts/:id/approve")
  @HttpCode(200)
  @RequirePermissions("chit:payout_approve")
  approvePayout(
    @Param("id", uuid) id: string,
    @Body(new ZodPipe(approvePayoutSchema)) body: { securityVerified: boolean; note?: string },
    @CurrentUser() actor: AuthUser,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.collect.approvePayout(id, body, actor, ctx);
  }

  @Post("payouts/:id/pay")
  @HttpCode(200)
  @RequirePermissions("chit:payout_approve")
  payPayout(
    @Param("id", uuid) id: string,
    @Body(new ZodPipe(payPayoutSchema)) body: { mode: PayMode; reference?: string; note?: string },
    @CurrentUser() actor: AuthUser,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.collect.payPayout(id, body, actor, ctx);
  }

  @Get("by-customer/:customerId")
  @RequirePermissions("chit:view")
  byCustomer(@Param("customerId", uuid) customerId: string) {
    return this.chits.byCustomer(customerId);
  }

  @Get("tickets/:ticketId/dues")
  @RequirePermissions("payment:view")
  dues(@Param("ticketId", uuid) ticketId: string, @Query(new ZodPipe(asOfQuery)) q: { asOf?: string }) {
    return this.collect.dues(ticketId, q.asOf);
  }

  @Get("tickets/:ticketId/passbook")
  @RequirePermissions("chit:view")
  passbook(@Param("ticketId", uuid) ticketId: string) {
    return this.collect.passbook(ticketId);
  }

  /** Requires an Idempotency-Key header: retries and double taps return the same receipt instead of a second payment. */
  @Post("tickets/:ticketId/payments")
  @HttpCode(201)
  @RequirePermissions("payment:create", "chit:view")
  receive(
    @Param("ticketId", uuid) ticketId: string,
    @Body(new ZodPipe(paymentSchema)) body: { amountPaise: number; mode: PayMode; reference?: string; paidOn?: string },
    @Headers("idempotency-key") key: string | undefined,
    @CurrentUser() actor: AuthUser,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.collect.receive(ticketId, body, key, actor, ctx);
  }

  @Get("payments/:id")
  @RequirePermissions("payment:view")
  receipt(@Param("id", uuid) id: string) {
    return this.collect.receipt(id);
  }

  @Post("payments/:id/reverse")
  @HttpCode(200)
  @RequirePermissions("payment:reverse")
  reversePayment(
    @Param("id", uuid) id: string,
    @Body(new ZodPipe(reversePaymentSchema)) body: { reason: string },
    @CurrentUser() actor: AuthUser,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.collect.reverse(id, body.reason, actor, ctx);
  }

  /* ---- groups ---- */

  @Get()
  @RequirePermissions("chit:view")
  list(@Query(new ZodPipe(chitListQuerySchema)) q: z.infer<typeof chitListQuerySchema>) {
    return this.chits.list(q);
  }

  @Post()
  @RequirePermissions("chit:create")
  create(
    @Body(new ZodPipe(createChitGroupSchema)) body: CreateChitGroupInput,
    @CurrentUser() actor: AuthUser,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.chits.create(actor, body, ctx);
  }

  @Get(":id")
  @RequirePermissions("chit:view")
  get(@Param("id", uuid) id: string) {
    return this.chits.get(id);
  }

  @Patch(":id")
  @RequirePermissions("chit:edit")
  update(
    @Param("id", uuid) id: string,
    @Body(new ZodPipe(updateChitGroupSchema)) body: Partial<CreateChitGroupInput>,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.chits.update(id, body, ctx);
  }

  @Post(":id/clone")
  @RequirePermissions("chit:create")
  clone(@Param("id", uuid) id: string, @CurrentUser() actor: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.chits.clone(actor, id, ctx);
  }

  @Post(":id/open")
  @HttpCode(200)
  @RequirePermissions("chit:edit")
  open(@Param("id", uuid) id: string, @Ctx() ctx: ReqCtx) {
    return this.chits.setStatus(id, "open", undefined, ctx);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermissions("chit:edit")
  cancel(
    @Param("id", uuid) id: string,
    @Body(new ZodPipe(cancelChitSchema)) body: { reason: string },
    @Ctx() ctx: ReqCtx,
  ) {
    return this.chits.setStatus(id, "cancel", body.reason, ctx);
  }

  @Post(":id/start")
  @HttpCode(200)
  @RequirePermissions("chit:edit")
  start(@Param("id", uuid) id: string, @Ctx() ctx: ReqCtx) {
    return this.chits.start(id, ctx);
  }

  @Post(":id/complete")
  @HttpCode(200)
  @RequirePermissions("chit:edit")
  complete(@Param("id", uuid) id: string, @Ctx() ctx: ReqCtx) {
    return this.chits.complete(id, ctx);
  }

  @Get(":id/statement")
  @RequirePermissions("chit:view")
  statement(@Param("id", uuid) id: string) {
    return this.collect.statement(id);
  }

  @Get(":id/collections")
  @RequirePermissions("payment:view")
  collections(@Param("id", uuid) id: string, @Query(new ZodPipe(asOfQuery)) q: { asOf?: string }) {
    return this.collect.collections(id, q.asOf);
  }

  /* ---- members ---- */

  @Post(":id/members")
  @RequirePermissions("chit:member_assign")
  enrol(
    @Param("id", uuid) id: string,
    @Body(new ZodPipe(enrolSchema)) body: { customerId: string; ticketNumber?: number },
    @Ctx() ctx: ReqCtx,
  ) {
    return this.chits.enrol(id, body, ctx);
  }

  @Delete(":id/members/:ticketId")
  @HttpCode(204)
  @RequirePermissions("chit:member_assign")
  async vacate(@Param("id", uuid) id: string, @Param("ticketId", uuid) ticketId: string, @Ctx() ctx: ReqCtx) {
    await this.chits.vacate(id, ticketId, ctx);
  }

  @Post(":id/members/:ticketId/transfer")
  @HttpCode(200)
  @RequirePermissions("chit:member_assign")
  transfer(
    @Param("id", uuid) id: string,
    @Param("ticketId", uuid) ticketId: string,
    @Body(new ZodPipe(transferSchema)) body: { toCustomerId: string; reason: string },
    @CurrentUser() actor: AuthUser,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.chits.transfer(id, ticketId, body.toCustomerId, body.reason, actor, ctx);
  }

  @Post(":id/waitlist")
  @RequirePermissions("chit:member_assign")
  addWait(
    @Param("id", uuid) id: string,
    @Body(new ZodPipe(waitlistSchema)) body: { customerId: string; note?: string },
    @Ctx() ctx: ReqCtx,
  ) {
    return this.chits.addToWaitlist(id, body.customerId, body.note, ctx);
  }

  @Delete(":id/waitlist/:waitId")
  @HttpCode(204)
  @RequirePermissions("chit:member_assign")
  async removeWait(@Param("id", uuid) id: string, @Param("waitId", uuid) waitId: string) {
    await this.chits.removeFromWaitlist(id, waitId);
  }

  /* ---- auction ---- */

  @Get(":id/cycles/:month")
  @RequirePermissions("chit:view")
  cycle(@Param("id", uuid) id: string, @Param("month", ParseIntPipe) month: number) {
    return this.chits.cycleDetail(id, month);
  }

  @Post(":id/cycles/:month/bids")
  @RequirePermissions("chit:auction_conduct")
  bid(
    @Param("id", uuid) id: string,
    @Param("month", ParseIntPipe) month: number,
    @Body(new ZodPipe(bidSchema)) body: { ticketId: string; discountPaise: number },
    @CurrentUser() actor: AuthUser,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.chits.recordBid(id, month, body, actor, ctx);
  }

  @Post(":id/cycles/:month/close")
  @HttpCode(200)
  @RequirePermissions("chit:auction_conduct")
  close(
    @Param("id", uuid) id: string,
    @Param("month", ParseIntPipe) month: number,
    @Body(new ZodPipe(closeAuctionSchema)) body: { note?: string },
    @CurrentUser() actor: AuthUser,
    @Ctx() ctx: ReqCtx,
  ) {
    return this.chits.closeAuction(id, month, body.note, actor, ctx);
  }
}
