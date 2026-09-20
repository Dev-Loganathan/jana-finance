-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('APPLIED', 'APPROVED', 'ACTIVE', 'CLOSED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CollateralKind" AS ENUM ('GOLD', 'PROPERTY', 'VEHICLE', 'CHEQUE', 'PROMISSORY_NOTE', 'DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "CollateralStatus" AS ENUM ('HELD', 'RELEASED');

-- AlterTable
ALTER TABLE "CustomerFile" ADD COLUMN     "collateralId" UUID;

-- CreateTable
CREATE TABLE "LoanProduct" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyRateBp" INTEGER NOT NULL,
    "minRateBp" INTEGER NOT NULL,
    "maxRateBp" INTEGER NOT NULL,
    "minAmountPaise" BIGINT NOT NULL,
    "maxAmountPaise" BIGINT NOT NULL,
    "processingFeeBp" INTEGER NOT NULL DEFAULT 0,
    "processingFeeFlatPaise" BIGINT NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "principalPaise" BIGINT NOT NULL,
    "monthlyRateBp" INTEGER NOT NULL,
    "termMonths" INTEGER,
    "purpose" TEXT,
    "processingFeePaise" BIGINT NOT NULL DEFAULT 0,
    "status" "LoanStatus" NOT NULL DEFAULT 'APPLIED',
    "notes" TEXT,
    "guarantorName" TEXT,
    "guarantorPhone" TEXT,
    "guarantorRelation" TEXT,
    "warnings" JSONB,
    "overrideReason" TEXT,
    "appliedById" UUID NOT NULL,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" UUID,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "disbursedOn" DATE,
    "disbursedById" UUID,
    "disbursedAt" TIMESTAMP(3),
    "disbursalMode" "PayMode",
    "disbursalReference" TEXT,
    "disbursalJournalId" UUID,
    "closedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanCollateral" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "kind" "CollateralKind" NOT NULL,
    "description" TEXT NOT NULL,
    "estimatedValuePaise" BIGINT NOT NULL DEFAULT 0,
    "reference" TEXT,
    "status" "CollateralStatus" NOT NULL DEFAULT 'HELD',
    "releasedAt" TIMESTAMP(3),
    "releaseNote" TEXT,
    "addedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanCollateral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanPayment" (
    "id" UUID NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "loanId" UUID NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "interestPaise" BIGINT NOT NULL DEFAULT 0,
    "principalPaise" BIGINT NOT NULL DEFAULT 0,
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

    CONSTRAINT "LoanPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanInterestAllocation" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "cycleSeq" INTEGER NOT NULL,
    "amountPaise" BIGINT NOT NULL,

    CONSTRAINT "LoanInterestAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoanProduct_name_key" ON "LoanProduct"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_code_key" ON "Loan"("code");

-- CreateIndex
CREATE INDEX "Loan_customerId_idx" ON "Loan"("customerId");

-- CreateIndex
CREATE INDEX "Loan_status_idx" ON "Loan"("status");

-- CreateIndex
CREATE INDEX "Loan_productId_idx" ON "Loan"("productId");

-- CreateIndex
CREATE INDEX "LoanCollateral_loanId_idx" ON "LoanCollateral"("loanId");

-- CreateIndex
CREATE UNIQUE INDEX "LoanPayment_receiptNo_key" ON "LoanPayment"("receiptNo");

-- CreateIndex
CREATE UNIQUE INDEX "LoanPayment_idempotencyKey_key" ON "LoanPayment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LoanPayment_loanId_idx" ON "LoanPayment"("loanId");

-- CreateIndex
CREATE INDEX "LoanPayment_paidOn_idx" ON "LoanPayment"("paidOn");

-- CreateIndex
CREATE INDEX "LoanInterestAllocation_paymentId_idx" ON "LoanInterestAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "LoanInterestAllocation_loanId_idx" ON "LoanInterestAllocation"("loanId");

-- CreateIndex
CREATE INDEX "CustomerFile_collateralId_idx" ON "CustomerFile"("collateralId");

-- AddForeignKey
ALTER TABLE "CustomerFile" ADD CONSTRAINT "CustomerFile_collateralId_fkey" FOREIGN KEY ("collateralId") REFERENCES "LoanCollateral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "LoanProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanCollateral" ADD CONSTRAINT "LoanCollateral_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanInterestAllocation" ADD CONSTRAINT "LoanInterestAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "LoanPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Human-friendly loan numbers (LN000001)
CREATE SEQUENCE loan_seq START 1;

-- Belt and braces: the application validates all of this too, but the database refuses nonsense regardless.
ALTER TABLE "Loan" ADD CONSTRAINT loan_amounts
  CHECK ("principalPaise" > 0 AND "processingFeePaise" >= 0 AND "monthlyRateBp" BETWEEN 1 AND 1000);
ALTER TABLE "LoanPayment" ADD CONSTRAINT loanpayment_amounts
  CHECK ("interestPaise" >= 0 AND "principalPaise" >= 0 AND "amountPaise" > 0
         AND "amountPaise" = "interestPaise" + "principalPaise");
ALTER TABLE "LoanInterestAllocation" ADD CONSTRAINT loanalloc_amounts
  CHECK ("amountPaise" > 0 AND "cycleSeq" >= 1);
