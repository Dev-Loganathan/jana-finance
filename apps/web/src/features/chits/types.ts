import type { ChitType } from "@jana/shared";

export type ChitStatus = "DRAFT" | "OPEN_FOR_ENROLMENT" | "RUNNING" | "COMPLETED" | "CANCELLED";

export interface ChitGroupSummary {
  id: string;
  code: string;
  name: string;
  type: ChitType;
  chitValuePaise: number;
  members: number;
  durationMonths: number;
  monthlySubscriptionPaise: number;
  commissionBp: number;
  minBidBp: number;
  maxBidBp: number;
  startDate: string;
  auctionDay: number;
  dueDaysAfterAuction: number;
  penaltyRateBp: number;
  penaltyGraceDays: number;
  registrationFeePaise: number;
  status: ChitStatus;
  notes: string | null;
  cancelledReason: string | null;
  filled?: number;
  vacant?: number;
  closedMonths?: number;
}

export interface Person {
  id: string;
  code: string;
  name: string;
  phone: string | null;
}

export interface ChitTicketRow {
  id: string;
  number: number;
  customer: Person | null;
  prized: boolean;
  prizedMonth: number | null;
  payoutOrder: number;
  advancePaise: number;
}

export interface ChitCycleRow {
  id: string;
  month: number;
  auctionDate: string;
  dueDate: string;
  status: "SCHEDULED" | "CLOSED";
  winnerTicketId: string | null;
  method: string | null;
  discountPaise: number | null;
  commissionPaise: number | null;
  dividendPerMemberPaise: number | null;
  residuePaise: number | null;
  prizePaise: number | null;
  netInstallmentPaise: number | null;
  note: string | null;
}

export interface ChitGroupDetail extends ChitGroupSummary {
  tickets: ChitTicketRow[];
  cycles: ChitCycleRow[];
  waitlist: { id: string; customer: Person | null; note: string | null }[];
}

export interface CycleDetail {
  group: {
    id: string;
    code: string;
    name: string;
    type: ChitType;
    chitValuePaise: number;
    members: number;
    commissionBp: number;
    status: ChitStatus;
  };
  cycle: ChitCycleRow;
  winner: { ticketId: string; number: number; customerName: string } | null;
  limits: { minDiscountPaise: number; maxDiscountPaise: number; commissionPaise: number };
  bids: {
    id: string;
    seq: number;
    ticketId: string;
    number: number;
    customerName: string;
    discountPaise: number;
    at: string;
  }[];
  eligible: { ticketId: string; number: number; customerName: string; inArrears: boolean }[];
}

export interface CollectionRow {
  ticketId: string;
  number: number;
  customerId: string | null;
  customerName: string;
  phone: string | null;
  outstandingPaise: number;
  overduePaise: number;
  penaltyPaise: number;
  advancePaise: number;
  oldestDueDate: string | null;
}

export interface Dues {
  asOf: string;
  ticket: { id: string; number: number; prized: boolean };
  group: { id: string; code: string; name: string; status: ChitStatus };
  customer: Person | null;
  installments: {
    id: string;
    month: number;
    dueDate: string;
    netDuePaise: number;
    paidPaise: number;
    outstandingPaise: number;
    penaltyPaise: number;
  }[];
  outstandingPaise: number;
  penaltyPaise: number;
  advancePaise: number;
  totalPayablePaise: number;
}

export interface Receipt {
  id: string;
  receiptNo: string;
  status: "POSTED" | "REVERSED";
  paidOn: string;
  amountPaise: number;
  mode: string;
  reference: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  group: { id: string; code: string; name: string };
  ticket: { id: string; number: number };
  customer: Person | null;
  allocations: {
    kind: "INSTALLMENT" | "PENALTY" | "ADVANCE" | "ADVANCE_APPLIED";
    month: number | null;
    amountPaise: number;
  }[];
  replayed?: boolean;
}

export interface Payout {
  id: string;
  status: "PENDING" | "APPROVED" | "PAID";
  group: { id: string; code: string; name: string };
  month: number;
  ticketNumber: number;
  customer: { id: string; code: string; name: string } | null;
  prizePaise: number;
  setOffPaise: number;
  netPaise: number;
  securityVerified: boolean;
  mode: string | null;
  reference: string | null;
  note: string | null;
}

export interface Passbook {
  ticket: { id: string; number: number; prized: boolean; prizedMonth: number | null };
  group: { id: string; code: string; name: string; status: ChitStatus; chitValuePaise: number };
  customer: { id: string; code: string; name: string } | null;
  months: {
    month: number;
    auctionDate: string;
    dueDate: string;
    basePaise: number;
    dividendPaise: number;
    netDuePaise: number | null;
    paidPaise: number;
    outstandingPaise: number | null;
    status: string;
    won: boolean;
  }[];
  prize: { month: number; status: string; prizePaise: number; setOffPaise: number; netPaise: number } | null;
  payments: { id: string; receiptNo: string; paidOn: string; amountPaise: number; mode: string; status: string }[];
  totals: { paidPaise: number; dividendsReceivedPaise: number; outstandingPaise: number; advancePaise: number };
}

export interface Statement {
  group: { id: string; code: string; name: string; status: ChitStatus };
  months: {
    month: number;
    auctionDate: string;
    status: string;
    winnerTicket: number | null;
    discountPaise: number | null;
    commissionPaise: number | null;
    dividendPerMemberPaise: number | null;
    prizePaise: number | null;
    payoutStatus: string | null;
    dueTotalPaise: number;
    collectedPaise: number;
    outstandingPaise: number;
  }[];
  totals: { dueTotalPaise: number; collectedPaise: number; outstandingPaise: number };
  poolBalancePaise: number;
}
