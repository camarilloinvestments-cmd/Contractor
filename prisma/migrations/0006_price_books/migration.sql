-- Workstreams G/H/I/J: Prime Contractor Price Books, imports, and rate books.
-- Additive, non-destructive. New enums + tables only; no existing columns changed.

-- CreateEnum
CREATE TYPE "PriceBookStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "PriceImportStatus" AS ENUM ('PENDING', 'APPROVED', 'CANCELLED');
CREATE TYPE "RateStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable PriceBook
CREATE TABLE "PriceBook" (
    "id" TEXT NOT NULL,
    "primeContractorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contract" TEXT,
    "project" TEXT,
    "market" TEXT,
    "region" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "PriceBookStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PriceBook_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PriceBook_primeContractorId_idx" ON "PriceBook"("primeContractorId");
CREATE INDEX "PriceBook_status_idx" ON "PriceBook"("status");

-- CreateTable PriceLine
CREATE TABLE "PriceLine" (
    "id" TEXT NOT NULL,
    "priceBookId" TEXT NOT NULL,
    "jobCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "ratePerUnit" INTEGER NOT NULL,
    "category" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PriceLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PriceLine_priceBookId_jobCode_key" ON "PriceLine"("priceBookId", "jobCode");
CREATE INDEX "PriceLine_jobCode_idx" ON "PriceLine"("jobCode");

-- CreateTable PriceImport
CREATE TABLE "PriceImport" (
    "id" TEXT NOT NULL,
    "primeContractorId" TEXT NOT NULL,
    "priceBookId" TEXT,
    "originalFilename" TEXT NOT NULL,
    "storagePath" TEXT,
    "fileType" TEXT,
    "status" "PriceImportStatus" NOT NULL DEFAULT 'PENDING',
    "usedAi" BOOLEAN NOT NULL DEFAULT false,
    "aiMapping" JSONB,
    "finalMapping" JSONB,
    "parsedRows" JSONB,
    "summary" JSONB,
    "errorRows" JSONB,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PriceImport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PriceImport_primeContractorId_idx" ON "PriceImport"("primeContractorId");
CREATE INDEX "PriceImport_status_idx" ON "PriceImport"("status");

-- CreateTable SubcontractorRate
CREATE TABLE "SubcontractorRate" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "jobCode" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT,
    "ratePerUnit" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "status" "RateStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubcontractorRate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SubcontractorRate_workerId_idx" ON "SubcontractorRate"("workerId");
CREATE INDEX "SubcontractorRate_jobCode_idx" ON "SubcontractorRate"("jobCode");

-- CreateTable InHouseRate
CREATE TABLE "InHouseRate" (
    "id" TEXT NOT NULL,
    "jobCode" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT,
    "ratePerUnit" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "status" "RateStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InHouseRate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InHouseRate_jobCode_idx" ON "InHouseRate"("jobCode");

-- AddForeignKey
ALTER TABLE "PriceBook" ADD CONSTRAINT "PriceBook_primeContractorId_fkey" FOREIGN KEY ("primeContractorId") REFERENCES "PrimeContractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceLine" ADD CONSTRAINT "PriceLine_priceBookId_fkey" FOREIGN KEY ("priceBookId") REFERENCES "PriceBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceImport" ADD CONSTRAINT "PriceImport_primeContractorId_fkey" FOREIGN KEY ("primeContractorId") REFERENCES "PrimeContractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceImport" ADD CONSTRAINT "PriceImport_priceBookId_fkey" FOREIGN KEY ("priceBookId") REFERENCES "PriceBook"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubcontractorRate" ADD CONSTRAINT "SubcontractorRate_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
