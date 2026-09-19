import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import { RequirePermissions } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { LedgerService } from "./ledger.service";

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  refType: z.string().max(40).optional(),
  refId: z.string().max(60).optional(),
});

@Controller("ledger")
export class LedgerController {
  constructor(private ledger: LedgerService) {}

  @Get("trial-balance")
  @RequirePermissions("report:view")
  trialBalance(@Query("asOf") asOf?: string) {
    return this.ledger.trialBalance(asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : undefined);
  }

  @Get("entries")
  @RequirePermissions("report:view")
  entries(@Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.ledger.listEntries(q);
  }
}
