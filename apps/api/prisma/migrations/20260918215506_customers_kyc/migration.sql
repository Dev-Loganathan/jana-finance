-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('SINGLE', 'MARRIED', 'WIDOWED', 'DIVORCED');

-- CreateEnum
CREATE TYPE "ResidenceType" AS ENUM ('OWN', 'RENTED', 'FAMILY', 'COMPANY');

-- CreateEnum
CREATE TYPE "OccupationType" AS ENUM ('SALARIED', 'SELF_EMPLOYED', 'BUSINESS', 'FARMER', 'RETIRED', 'STUDENT', 'OTHER');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "CreditCategory" AS ENUM ('EXCELLENT', 'GOOD', 'MEDIUM', 'POOR');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PARTIAL', 'COMPLETE', 'VERIFIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "KycDocType" AS ENUM ('AADHAAR', 'PAN', 'VOTER_ID', 'DRIVING_LICENCE', 'PASSPORT', 'PHOTO', 'SIGNATURE', 'ADDRESS_PROOF', 'INCOME_PROOF', 'BANK_STATEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "KycDocStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "CustomerStatus" NOT NULL DEFAULT 'DRAFT',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL DEFAULT '',
    "gender" "Gender",
    "dob" DATE,
    "phone" TEXT,
    "altPhone" TEXT,
    "email" TEXT,
    "maritalStatus" "MaritalStatus",
    "currentAddress" TEXT,
    "permanentAddress" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "state" TEXT,
    "district" TEXT,
    "pincode" TEXT,
    "landmark" TEXT,
    "residenceType" "ResidenceType",
    "occupationType" "OccupationType",
    "companyName" TEXT,
    "designation" TEXT,
    "workExperience" TEXT,
    "monthlyIncomePaise" BIGINT NOT NULL DEFAULT 0,
    "additionalIncomePaise" BIGINT NOT NULL DEFAULT 0,
    "businessName" TEXT,
    "fatherName" TEXT,
    "motherName" TEXT,
    "spouseName" TEXT,
    "nomineeName" TEXT,
    "nomineeRelation" TEXT,
    "cibilScore" INTEGER,
    "existingLoans" INTEGER NOT NULL DEFAULT 0,
    "monthlyEmiPaise" BIGINT NOT NULL DEFAULT 0,
    "dtiBp" INTEGER,
    "riskLevel" "RiskLevel",
    "category" "CreditCategory",
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "completedSteps" TEXT[],
    "lastStep" TEXT NOT NULL DEFAULT 'basic',
    "consentAt" TIMESTAMP(3),
    "consentById" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerReference" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CustomerReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumberEnc" TEXT NOT NULL,
    "accountLast4" TEXT NOT NULL,
    "accountLength" INTEGER NOT NULL,
    "accountHash" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycDocument" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "type" "KycDocType" NOT NULL,
    "numberEnc" TEXT,
    "numberLast4" TEXT,
    "numberLength" INTEGER,
    "numberHash" TEXT,
    "status" "KycDocStatus" NOT NULL DEFAULT 'PENDING',
    "issueDate" DATE,
    "expiryDate" DATE,
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerFile" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "documentId" UUID,
    "label" TEXT NOT NULL DEFAULT '',
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE INDEX "Customer_status_deletedAt_idx" ON "Customer"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "Customer_riskLevel_idx" ON "Customer"("riskLevel");

-- CreateIndex
CREATE INDEX "Customer_kycStatus_idx" ON "Customer"("kycStatus");

-- CreateIndex
CREATE INDEX "BankAccount_accountHash_idx" ON "BankAccount"("accountHash");

-- CreateIndex
CREATE INDEX "KycDocument_numberHash_idx" ON "KycDocument"("numberHash");

-- CreateIndex
CREATE INDEX "KycDocument_status_idx" ON "KycDocument"("status");

-- CreateIndex
CREATE UNIQUE INDEX "KycDocument_customerId_type_key" ON "KycDocument"("customerId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFile_storageKey_key" ON "CustomerFile"("storageKey");

-- CreateIndex
CREATE INDEX "CustomerFile_customerId_idx" ON "CustomerFile"("customerId");

-- CreateIndex
CREATE INDEX "CustomerFile_documentId_idx" ON "CustomerFile"("documentId");

-- AddForeignKey
ALTER TABLE "CustomerReference" ADD CONSTRAINT "CustomerReference_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFile" ADD CONSTRAINT "CustomerFile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFile" ADD CONSTRAINT "CustomerFile_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KycDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fuzzy name matching for duplicate detection and search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Customer_name_trgm_idx" ON "Customer" USING gin (lower("firstName" || ' ' || "lastName") gin_trgm_ops);

-- Human-readable customer codes: CUS1000, CUS1001, ... (gaps are possible and harmless)
CREATE SEQUENCE customer_code_seq START 1000;
