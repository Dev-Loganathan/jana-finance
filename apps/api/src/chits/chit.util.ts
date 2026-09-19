import type { ChitCycle, ChitGroup, ChitTicket } from "@prisma/client";

export const num = (v: bigint | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
export const dateStr = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Today's date in the business timezone (Asia/Kolkata), as YYYY-MM-DD. */
export function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

export function toGroupDto(g: ChitGroup, tickets?: Pick<ChitTicket, "customerId">[], closedMonths?: number) {
  const filled = tickets ? tickets.filter((t) => t.customerId).length : undefined;
  return {
    id: g.id,
    code: g.code,
    name: g.name,
    type: g.type,
    chitValuePaise: num(g.chitValuePaise),
    members: g.members,
    durationMonths: g.durationMonths,
    monthlySubscriptionPaise: num(g.monthlySubscriptionPaise),
    commissionBp: g.commissionBp,
    minBidBp: g.minBidBp,
    maxBidBp: g.maxBidBp,
    startDate: dateStr(g.startDate),
    auctionDay: g.auctionDay,
    dueDaysAfterAuction: g.dueDaysAfterAuction,
    penaltyRateBp: g.penaltyRateBp,
    penaltyGraceDays: g.penaltyGraceDays,
    registrationFeePaise: num(g.registrationFeePaise),
    status: g.status,
    notes: g.notes,
    cancelledReason: g.cancelledReason,
    createdAt: g.createdAt,
    ...(filled !== undefined && { filled, vacant: g.members - filled }),
    ...(closedMonths !== undefined && { closedMonths }),
  };
}

export function toCycleDto(c: ChitCycle) {
  return {
    id: c.id,
    month: c.month,
    auctionDate: dateStr(c.auctionDate),
    dueDate: dateStr(c.dueDate),
    status: c.status,
    winnerTicketId: c.winnerTicketId,
    method: c.method,
    discountPaise: c.discountPaise === null ? null : num(c.discountPaise),
    commissionPaise: c.commissionPaise === null ? null : num(c.commissionPaise),
    dividendPerMemberPaise: c.dividendPerMemberPaise === null ? null : num(c.dividendPerMemberPaise),
    residuePaise: c.residuePaise === null ? null : num(c.residuePaise),
    prizePaise: c.prizePaise === null ? null : num(c.prizePaise),
    netInstallmentPaise: c.netInstallmentPaise === null ? null : num(c.netInstallmentPaise),
    note: c.note,
    closedAt: c.closedAt,
  };
}
