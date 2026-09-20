-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('VALIDATED', 'IMPORTING', 'IMPORTED', 'DISCARDED', 'EXPIRED');

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'VALIDATED',
    "totalRows" INTEGER NOT NULL,
    "readyRows" INTEGER NOT NULL,
    "errorRows" INTEGER NOT NULL,
    "duplicateRows" INTEGER NOT NULL,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "dataEnc" TEXT,
    "createdCodes" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportBatch_createdById_createdAt_idx" ON "ImportBatch"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "ImportBatch_expiresAt_idx" ON "ImportBatch"("expiresAt");
