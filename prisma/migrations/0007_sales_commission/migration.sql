-- CreateEnum
CREATE TYPE "SalespersonStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CommissionPlanType" AS ENUM ('PERCENT_REVENUE', 'PERCENT_GROSS_PROFIT', 'FLAT_PER_JOB', 'FLAT_PER_TASK', 'PRODUCTION_RATE', 'TIERED');

-- CreateEnum
CREATE TYPE "CommissionEarnedEvent" AS ENUM ('JOB_COMPLETED', 'JOB_APPROVED', 'INVOICE_GENERATED', 'INVOICE_PAID');

-- CreateEnum
CREATE TYPE "CommissionPlanStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CommissionRecordStatus" AS ENUM ('PENDING', 'EARNED', 'PAID', 'VOID');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'SALES';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "commissionPlanId" TEXT,
ADD COLUMN     "otherDirectCosts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salespersonId" TEXT;

-- CreateTable
CREATE TABLE "Salesperson" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "userId" TEXT,
    "status" "SalespersonStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Salesperson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "planType" "CommissionPlanType" NOT NULL,
    "earnedEvent" "CommissionEarnedEvent" NOT NULL DEFAULT 'INVOICE_PAID',
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" "CommissionPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRecord" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "salespersonId" TEXT NOT NULL,
    "planId" TEXT,
    "planName" TEXT NOT NULL,
    "planType" "CommissionPlanType" NOT NULL,
    "earnedEvent" "CommissionEarnedEvent" NOT NULL,
    "rateSnapshot" JSONB NOT NULL DEFAULT '{}',
    "basisAmount" INTEGER NOT NULL DEFAULT 0,
    "commissionAmount" INTEGER NOT NULL DEFAULT 0,
    "status" "CommissionRecordStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Salesperson_userId_key" ON "Salesperson"("userId");

-- CreateIndex
CREATE INDEX "Salesperson_status_idx" ON "Salesperson"("status");

-- CreateIndex
CREATE INDEX "CommissionPlan_status_idx" ON "CommissionPlan"("status");

-- CreateIndex
CREATE INDEX "CommissionRecord_jobId_idx" ON "CommissionRecord"("jobId");

-- CreateIndex
CREATE INDEX "CommissionRecord_salespersonId_idx" ON "CommissionRecord"("salespersonId");

-- CreateIndex
CREATE INDEX "CommissionRecord_status_idx" ON "CommissionRecord"("status");

-- CreateIndex
CREATE INDEX "Job_salespersonId_idx" ON "Job"("salespersonId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "Salesperson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_commissionPlanId_fkey" FOREIGN KEY ("commissionPlanId") REFERENCES "CommissionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRecord" ADD CONSTRAINT "CommissionRecord_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRecord" ADD CONSTRAINT "CommissionRecord_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "Salesperson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRecord" ADD CONSTRAINT "CommissionRecord_planId_fkey" FOREIGN KEY ("planId") REFERENCES "CommissionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

