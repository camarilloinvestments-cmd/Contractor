-- Option A: first-class Project entity + immutable, pinnable PriceBookVersion.
-- Hierarchy: PrimeContractor -> Project -> PriceBook -> PriceBookVersion -> PriceLine (billing/SOW codes)
--            -> Work Order (Job) pins (primeContractorId, projectId, priceBookId, priceBookVersionId)
--            -> Task snapshots the resolved code from the WO's pinned version.
-- Additive + backfill. Existing data preserved; every existing PriceBook receives one
-- PriceBookVersion so its PriceLines are attached to an immutable version.

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateTable Project
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "primeContractorId" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "projectName" TEXT,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "defaultPriceBookId" TEXT,
    "defaultPriceBookVersionId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Project_primeContractorId_projectCode_key" ON "Project"("primeContractorId", "projectCode");
CREATE INDEX "Project_primeContractorId_idx" ON "Project"("primeContractorId");
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateTable PriceBookVersion
CREATE TABLE "PriceBookVersion" (
    "id" TEXT NOT NULL,
    "priceBookId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "status" "PriceBookStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PriceBookVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PriceBookVersion_priceBookId_version_key" ON "PriceBookVersion"("priceBookId", "version");
CREATE INDEX "PriceBookVersion_priceBookId_idx" ON "PriceBookVersion"("priceBookId");
CREATE INDEX "PriceBookVersion_status_idx" ON "PriceBookVersion"("status");

-- AlterTable PriceBook: add normalized project FK (legacy free-text "project" column retained, now mapped to projectLabel)
ALTER TABLE "PriceBook" ADD COLUMN "projectId" TEXT;
CREATE INDEX "PriceBook_projectId_idx" ON "PriceBook"("projectId");

-- AlterTable PriceLine: attach each line to an immutable version (nullable for backfill first)
ALTER TABLE "PriceLine" ADD COLUMN "priceBookVersionId" TEXT;

-- AlterTable Job: work-order pinning (all nullable; existing jobs remain unpinned)
ALTER TABLE "Job" ADD COLUMN "projectId" TEXT;
ALTER TABLE "Job" ADD COLUMN "priceBookId" TEXT;
ALTER TABLE "Job" ADD COLUMN "priceBookVersionId" TEXT;

-- AlterTable Task: historical snapshot of the resolved code
ALTER TABLE "Task" ADD COLUMN "priceBookId" TEXT;
ALTER TABLE "Task" ADD COLUMN "priceBookVersionId" TEXT;
ALTER TABLE "Task" ADD COLUMN "billingCode" TEXT;
ALTER TABLE "Task" ADD COLUMN "descriptionSnapshot" TEXT;
ALTER TABLE "Task" ADD COLUMN "unitSnapshot" TEXT;
ALTER TABLE "Task" ADD COLUMN "primeRatePerUnitSnapshot" INTEGER;
ALTER TABLE "Task" ADD COLUMN "calculatedPrimeAmount" INTEGER;

-- AlterTable PriceImport: record which version an approved import produced
ALTER TABLE "PriceImport" ADD COLUMN "priceBookVersionId" TEXT;

-- ============================================================================
-- BACKFILL: one PriceBookVersion per existing PriceBook, deterministic id
-- ('pbv_' || book id => guaranteed unique because a book maps to exactly one row here).
-- ============================================================================
INSERT INTO "PriceBookVersion" (
    "id", "priceBookId", "version", "label", "effectiveDate", "expirationDate",
    "status", "notes", "createdById", "createdAt", "updatedAt"
)
SELECT
    'pbv_' || pb."id",
    pb."id",
    pb."version",
    'Migrated v' || pb."version"::text,
    pb."effectiveDate",
    pb."expirationDate",
    pb."status",
    pb."notes",
    pb."createdById",
    pb."createdAt",
    pb."updatedAt"
FROM "PriceBook" pb;

-- Attach every existing PriceLine to its book's migrated version.
UPDATE "PriceLine" pl
SET "priceBookVersionId" = 'pbv_' || pl."priceBookId";

-- Point each PriceImport that already produced a book at the migrated version.
UPDATE "PriceImport" pi
SET "priceBookVersionId" = 'pbv_' || pi."priceBookId"
WHERE pi."priceBookId" IS NOT NULL;

-- Now enforce NOT NULL on PriceLine.priceBookVersionId (all rows backfilled above).
ALTER TABLE "PriceLine" ALTER COLUMN "priceBookVersionId" SET NOT NULL;

-- Swap the uniqueness of a code from (book, code) to (version, code):
-- codes are opaque and scoped to a version; the same code may legitimately exist
-- across different versions of the same book.
DROP INDEX "PriceLine_priceBookId_jobCode_key";
CREATE UNIQUE INDEX "PriceLine_priceBookVersionId_jobCode_key" ON "PriceLine"("priceBookVersionId", "jobCode");
CREATE INDEX "PriceLine_priceBookId_idx" ON "PriceLine"("priceBookId");

-- Job pin indexes
CREATE INDEX "Job_projectId_idx" ON "Job"("projectId");
CREATE INDEX "Job_priceBookId_idx" ON "Job"("priceBookId");
CREATE INDEX "Job_priceBookVersionId_idx" ON "Job"("priceBookVersionId");

-- Task snapshot index
CREATE INDEX "Task_priceBookVersionId_idx" ON "Task"("priceBookVersionId");

-- ============================================================================
-- Foreign keys
-- ============================================================================
ALTER TABLE "Project" ADD CONSTRAINT "Project_primeContractorId_fkey" FOREIGN KEY ("primeContractorId") REFERENCES "PrimeContractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_defaultPriceBookId_fkey" FOREIGN KEY ("defaultPriceBookId") REFERENCES "PriceBook"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_defaultPriceBookVersionId_fkey" FOREIGN KEY ("defaultPriceBookVersionId") REFERENCES "PriceBookVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PriceBookVersion" ADD CONSTRAINT "PriceBookVersion_priceBookId_fkey" FOREIGN KEY ("priceBookId") REFERENCES "PriceBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PriceBook" ADD CONSTRAINT "PriceBook_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PriceLine" ADD CONSTRAINT "PriceLine_priceBookVersionId_fkey" FOREIGN KEY ("priceBookVersionId") REFERENCES "PriceBookVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Job" ADD CONSTRAINT "Job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_priceBookId_fkey" FOREIGN KEY ("priceBookId") REFERENCES "PriceBook"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_priceBookVersionId_fkey" FOREIGN KEY ("priceBookVersionId") REFERENCES "PriceBookVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Task" ADD CONSTRAINT "Task_priceBookVersionId_fkey" FOREIGN KEY ("priceBookVersionId") REFERENCES "PriceBookVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PriceImport" ADD CONSTRAINT "PriceImport_priceBookVersionId_fkey" FOREIGN KEY ("priceBookVersionId") REFERENCES "PriceBookVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
