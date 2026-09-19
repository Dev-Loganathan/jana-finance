-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'INCOME', 'EXPENSE', 'EQUITY');

-- CreateEnum
CREATE TYPE "ChitType" AS ENUM ('AUCTION', 'LOTTERY', 'FIXED');

-- CreateEnum
CREATE TYPE "ChitStatus" AS ENUM ('DRAFT', 'OPEN_FOR_ENROLMENT', 'RUNNING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('SCHEDULED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PayMode" AS ENUM ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'SET_OFF');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID');

-- CreateEnum
CREATE TYPE "AllocationKind" AS ENUM ('INSTALLMENT', 'PENALTY', 'ADVANCE', 'ADVANCE_APPLIED');

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "memo" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "reversesId" UUID,
    "postedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "debitPaise" BIGINT NOT NULL DEFAULT 0,
    "creditPaise" BIGINT NOT NULL DEFAULT 0,
    "dimension" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChitGroup" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ChitType" NOT NULL DEFAULT 'AUCTION',
    "chitValuePaise" BIGINT NOT NULL,
    "members" INTEGER NOT NULL,
    "durationMonths" INTEGER NOT NULL,
    "monthlySubscriptionPaise" BIGINT NOT NULL,
    "commissionBp" INTEGER NOT NULL DEFAULT 500,
    "minBidBp" INTEGER NOT NULL,
    "maxBidBp" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "auctionDay" INTEGER NOT NULL,
    "dueDaysAfterAuction" INTEGER NOT NULL DEFAULT 5,
    "penaltyRateBp" INTEGER NOT NULL DEFAULT 0,
    "penaltyGraceDays" INTEGER NOT NULL DEFAULT 3,
    "registrationFeePaise" BIGINT NOT NULL DEFAULT 0,
    "status" "ChitStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "cancelledReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ChitGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChitTicket" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "customerId" UUID,
    "prized" BOOLEAN NOT NULL DEFAULT false,
    "prizedMonth" INTEGER,
    "payoutOrder" INTEGER NOT NULL,
    "advancePaise" BIGINT NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChitTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChitWaitlist" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChitWaitlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChitTransfer" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "fromCustomerId" UUID NOT NULL,
    "toCustomerId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "byUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChitTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChitCycle" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "month" INTEGER NOT NULL,
    "auctionDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "CycleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "winnerTicketId" UUID,
    "method" TEXT,
    "discountPaise" BIGINT,
    "commissionPaise" BIGINT,
    "dividendPerMemberPaise" BIGINT,
    "residuePaise" BIGINT,
    "prizePaise" BIGINT,
    "netInstallmentPaise" BIGINT,
    "note" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" UUID,
    "commissionEntryId" UUID,

    CONSTRAINT "ChitCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChitBid" (
    "id" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "discountPaise" BIGINT NOT NULL,
    "seq" INTEGER NOT NULL,
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChitBid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChitInstallment" (
    "id" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "dueDate" DATE NOT NULL,
    "basePaise" BIGINT NOT NULL,
    "dividendPaise" BIGINT NOT NULL DEFAULT 0,
    "netDuePaise" BIGINT,
    "paidPaise" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "ChitInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChitPayment" (
    "id" UUID NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "groupId" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "mode" "PayMode" NOT NULL,
    "reference" TEXT,
    "paidOn" DATE NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'POSTED',
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "journalEntryId" UUID,
    "receivedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChitPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChitPaymentAllocation" (
    "id" UUID NOT NULL,
    "paymentId" UUID,
    "installmentId" UUID,
    "ticketId" UUID NOT NULL,
    "kind" "AllocationKind" NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChitPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChitPayout" (
    "id" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "prizePaise" BIGINT NOT NULL,
    "setOffPaise" BIGINT NOT NULL DEFAULT 0,
    "netPaise" BIGINT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "securityVerified" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "paidById" UUID,
    "paidAt" TIMESTAMP(3),
    "mode" "PayMode",
    "reference" TEXT,
    "note" TEXT,
    "journalEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChitPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_code_key" ON "Account"("code");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_number_key" ON "JournalEntry"("number");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_idempotencyKey_key" ON "JournalEntry"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reversesId_key" ON "JournalEntry"("reversesId");

-- CreateIndex
CREATE INDEX "JournalEntry_refType_refId_idx" ON "JournalEntry"("refType", "refId");

-- CreateIndex
CREATE INDEX "JournalEntry_entryDate_idx" ON "JournalEntry"("entryDate");

-- CreateIndex
CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");

-- CreateIndex
CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");

-- CreateIndex
CREATE INDEX "JournalLine_dimension_idx" ON "JournalLine"("dimension");

-- CreateIndex
CREATE UNIQUE INDEX "ChitGroup_code_key" ON "ChitGroup"("code");

-- CreateIndex
CREATE INDEX "ChitGroup_status_deletedAt_idx" ON "ChitGroup"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "ChitTicket_customerId_idx" ON "ChitTicket"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "ChitTicket_groupId_number_key" ON "ChitTicket"("groupId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ChitWaitlist_groupId_customerId_key" ON "ChitWaitlist"("groupId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "ChitCycle_groupId_month_key" ON "ChitCycle"("groupId", "month");

-- CreateIndex
CREATE INDEX "ChitBid_cycleId_idx" ON "ChitBid"("cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "ChitBid_cycleId_seq_key" ON "ChitBid"("cycleId", "seq");

-- CreateIndex
CREATE INDEX "ChitInstallment_ticketId_idx" ON "ChitInstallment"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "ChitInstallment_cycleId_ticketId_key" ON "ChitInstallment"("cycleId", "ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "ChitPayment_receiptNo_key" ON "ChitPayment"("receiptNo");

-- CreateIndex
CREATE UNIQUE INDEX "ChitPayment_idempotencyKey_key" ON "ChitPayment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ChitPayment_ticketId_idx" ON "ChitPayment"("ticketId");

-- CreateIndex
CREATE INDEX "ChitPayment_groupId_idx" ON "ChitPayment"("groupId");

-- CreateIndex
CREATE INDEX "ChitPaymentAllocation_paymentId_idx" ON "ChitPaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "ChitPaymentAllocation_installmentId_idx" ON "ChitPaymentAllocation"("installmentId");

-- CreateIndex
CREATE INDEX "ChitPaymentAllocation_ticketId_idx" ON "ChitPaymentAllocation"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "ChitPayout_cycleId_key" ON "ChitPayout"("cycleId");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChitTicket" ADD CONSTRAINT "ChitTicket_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChitGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChitWaitlist" ADD CONSTRAINT "ChitWaitlist_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChitGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChitTransfer" ADD CONSTRAINT "ChitTransfer_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ChitTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChitCycle" ADD CONSTRAINT "ChitCycle_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChitGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChitBid" ADD CONSTRAINT "ChitBid_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ChitCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChitBid" ADD CONSTRAINT "ChitBid_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ChitTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChitInstallment" ADD CONSTRAINT "ChitInstallment_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ChitCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChitInstallment" ADD CONSTRAINT "ChitInstallment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ChitTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChitPayment" ADD CONSTRAINT "ChitPayment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ChitTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChitPaymentAllocation" ADD CONSTRAINT "ChitPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "ChitPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChitPaymentAllocation" ADD CONSTRAINT "ChitPaymentAllocation_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "ChitInstallment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChitPayout" ADD CONSTRAINT "ChitPayout_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ChitCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============ Ledger integrity (database-level) ============
CREATE OR REPLACE FUNCTION ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: post a reversing entry instead', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entry_immutable BEFORE UPDATE OR DELETE ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER journal_line_immutable  BEFORE UPDATE OR DELETE ON "JournalLine"  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

-- Every entry must balance (debits = credits) and each line must be a single-sided, non-negative amount.
ALTER TABLE "JournalLine" ADD CONSTRAINT journal_line_one_sided
  CHECK ("debitPaise" >= 0 AND "creditPaise" >= 0 AND ("debitPaise" = 0 OR "creditPaise" = 0) AND ("debitPaise" + "creditPaise") > 0);

CREATE OR REPLACE FUNCTION journal_entry_balanced() RETURNS trigger AS $$
DECLARE d bigint; c bigint;
BEGIN
  SELECT COALESCE(SUM("debitPaise"),0), COALESCE(SUM("creditPaise"),0) INTO d, c FROM "JournalLine" WHERE "entryId" = NEW."entryId";
  IF d <> c THEN
    RAISE EXCEPTION 'Journal entry % does not balance (debits %, credits %)', NEW."entryId", d, c;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_entry_balanced_check
  AFTER INSERT ON "JournalLine" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();

-- The auction record of bids can never be edited or removed.
CREATE TRIGGER chit_bid_immutable BEFORE UPDATE OR DELETE ON "ChitBid" FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

-- Human-readable numbers
CREATE SEQUENCE chit_group_seq START 1;
CREATE SEQUENCE receipt_seq START 1;
CREATE SEQUENCE journal_seq START 1;
