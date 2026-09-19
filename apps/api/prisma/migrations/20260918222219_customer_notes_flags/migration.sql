-- CreateEnum
CREATE TYPE "WatchStatus" AS ENUM ('NONE', 'WATCHLIST', 'BLACKLIST');

-- CreateEnum
CREATE TYPE "NoteKind" AS ENUM ('NOTE', 'CALL', 'VISIT');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "tags" TEXT[],
ADD COLUMN     "watchReason" TEXT,
ADD COLUMN     "watchSetAt" TIMESTAMP(3),
ADD COLUMN     "watchSetById" UUID,
ADD COLUMN     "watchStatus" "WatchStatus" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "CustomerNote" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "kind" "NoteKind" NOT NULL DEFAULT 'NOTE',
    "body" TEXT NOT NULL,
    "outcome" TEXT,
    "followUpOn" DATE,
    "completedAt" TIMESTAMP(3),
    "authorId" UUID NOT NULL,
    "authorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerNote_customerId_createdAt_idx" ON "CustomerNote"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerNote_followUpOn_completedAt_idx" ON "CustomerNote"("followUpOn", "completedAt");

-- AddForeignKey
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
