export interface Dashboard {
  asOf: string;
  customers?: {
    total: number;
    active: number;
    inactive: number;
    drafts: number;
    highRisk: number;
    kycPending: number;
    kyc: Record<"VERIFIED" | "COMPLETE" | "PARTIAL" | "NOT_STARTED" | "EXPIRED", number>;
    risk: Record<"LOW" | "MEDIUM" | "HIGH", number>;
    watchlist: number;
    blacklist: number;
  };
  chits?: {
    running: number;
    open: number;
    draft: number;
    completed: number;
    pendingPayouts: number;
    pendingPayoutsPaise: number;
    upcomingAuctions: { groupId: string; code: string; name: string; month: number; date: string; overdue: boolean }[];
  };
  collections?: {
    todayPaise: number;
    todayCount: number;
    monthPaise: number;
    monthCount: number;
    months: { month: string; paise: number }[];
  };
  overdue?: {
    totalPaise: number;
    members: number;
    buckets: { bucket: string; count: number; paise: number }[];
    topDefaulters: {
      customerId: string;
      code: string;
      name: string;
      phone: string | null;
      overduePaise: number;
      daysPastDue: number;
      tickets: number;
    }[];
  };
  cash?: { cashPaise: number; bankPaise: number; totalPaise: number; heldForMembersPaise: number };
  staff?: { collectionsThisMonth: { userId: string; name: string; paise: number; receipts: number }[] };
  followUps?: { dueToday: number; overdue: number };
}
