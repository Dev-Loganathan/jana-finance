import type { LoanStatus } from "@jana/shared";

export type { LoanStatus };

export interface LoanProduct {
  id: string;
  name: string;
  monthlyRateBp: number;
  minRateBp: number;
  maxRateBp: number;
  minAmountPaise: number;
  maxAmountPaise: number;
  processingFeeBp: number;
  processingFeeFlatPaise: number;
  active: boolean;
  notes: string | null;
}

export interface InterestCycle {
  seq: number;
  periodStart: string;
  dueDate: string;
  accruedPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  complete: boolean;
  overdueDays: number;
}

export interface LoanPosition {
  principalOutstandingPaise: number;
  cycles: InterestCycle[];
  interestDuePaise: number;
  interestOverduePaise: number;
  interestAccruingPaise: number;
  interestPayablePaise: number;
  payoffPaise: number;
  nextDueDate: string | null;
  overdueCycles: number;
  oldestOverdueDays: number;
}

export interface LoanListItem {
  id: string;
  code: string;
  status: LoanStatus;
  productName: string;
  customer: { id: string; code: string; name: string; phone: string | null } | undefined;
  principalPaise: number;
  monthlyRateBp: number;
  disbursedOn: string | null;
  closedOn: string | null;
  principalOutstandingPaise: number | null;
  interestDuePaise: number | null;
  interestOverduePaise: number | null;
  interestPayablePaise: number | null;
  nextDueDate: string | null;
  overdueDays: number;
  bucket?: "overdue" | "today" | "week" | "later";
}

export interface InterestDueResult {
  asOf: string;
  counts: { overdue: number; today: number; week: number };
  totals: { interestDuePaise: number; interestOverduePaise: number };
  total: number;
  items: LoanListItem[];
}

export interface LoanStats {
  applied: number;
  approved: number;
  active: number;
  closed: number;
  principalOutstandingPaise: number;
  interestDuePaise: number;
  interestOverduePaise: number;
  overdueLoans: number;
}

export interface Collateral {
  id: string;
  kind: string;
  description: string;
  estimatedValuePaise: number;
  reference: string | null;
  status: "HELD" | "RELEASED";
  releasedAt: string | null;
  releaseNote: string | null;
  files: { id: string; label: string; mimeType: string }[];
}

export interface LoanPaymentRow {
  id: string;
  receiptNo: string;
  paidOn: string;
  amountPaise: number;
  interestPaise: number;
  principalPaise: number;
  mode: string;
  status: "POSTED" | "REVERSED";
}

export interface LoanDetail {
  id: string;
  code: string;
  status: LoanStatus;
  asOf: string;
  customer: {
    id: string;
    code: string;
    name: string;
    phone: string | null;
    kycStatus: string;
    watchStatus: string;
    cibilScore: number | null;
  } | null;
  product: LoanProduct;
  principalPaise: number;
  monthlyRateBp: number;
  yearlyPercent: number;
  monthlyInterestPaise: number;
  termMonths: number | null;
  purpose: string | null;
  processingFeePaise: number;
  notes: string | null;
  guarantor: { name: string; phone: string | null; relation: string | null } | null;
  warnings: string[];
  overrideReason: string | null;
  rejectionReason: string | null;
  appliedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  disbursedBy: string | null;
  disbursedOn: string | null;
  disbursalMode: string | null;
  closedOn: string | null;
  createdAt: string;
  position: LoanPosition | null;
  collaterals: Collateral[];
  payments: LoanPaymentRow[];
  lastPaymentOn: string | null;
}

export interface LoanReceipt {
  id: string;
  receiptNo: string;
  status: "POSTED" | "REVERSED";
  paidOn: string;
  amountPaise: number;
  interestPaise: number;
  principalPaise: number;
  mode: string;
  reference: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  loan: { id: string; code: string; status: LoanStatus; monthlyRateBp: number };
  customer: { id: string; code: string; name: string; phone: string | null } | null;
  interestFor: { month: number; dueDate: string | null; amountPaise: number }[];
  principalOutstandingAfterPaise: number | null;
  replayed?: boolean;
}

export interface LoanPreview {
  monthlyInterestPaise: number;
  yearlyPercent: number;
  processingFeePaise: number;
  blockers: string[];
  warnings: string[];
}
