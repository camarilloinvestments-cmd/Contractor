-- Phase 3: Commercial Documents (Estimates, Quotes, revision/send history, numbering)
-- Additive & idempotent. Safe to run against an existing production database.

-- Enums --------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "EstimateStatus" AS ENUM ('DRAFT','SENT','APPROVED','DECLINED','EXPIRED','CONVERTED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT','SENT','VIEWED','ACCEPTED','REJECTED','EXPIRED','CANCELLED','CONVERTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Provenance column on Job (Work Order) ------------------------------------
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "sourceQuoteId" TEXT;
CREATE INDEX IF NOT EXISTS "Job_sourceQuoteId_idx" ON "Job"("sourceQuoteId");

-- DocumentCounter ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "DocumentCounter" (
  "key"       TEXT NOT NULL,
  "prefix"    TEXT NOT NULL,
  "value"     INTEGER NOT NULL DEFAULT 0,
  "padding"   INTEGER NOT NULL DEFAULT 5,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("key")
);

-- Estimate -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Estimate" (
  "id"                 TEXT NOT NULL,
  "estimateNumber"     TEXT NOT NULL,
  "primeContractorId"  TEXT NOT NULL,
  "projectId"          TEXT,
  "title"              TEXT,
  "status"             "EstimateStatus" NOT NULL DEFAULT 'DRAFT',
  "issueDate"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expirationDate"     TIMESTAMP(3),
  "subtotal"           INTEGER NOT NULL DEFAULT 0,
  "taxRate"            DOUBLE PRECISION NOT NULL DEFAULT 0,
  "taxAmount"          INTEGER NOT NULL DEFAULT 0,
  "total"              INTEGER NOT NULL DEFAULT 0,
  "assumptions"        TEXT,
  "exclusions"         TEXT,
  "notes"              TEXT,
  "currentRevision"    INTEGER NOT NULL DEFAULT 0,
  "lastEmailedAt"      TIMESTAMP(3),
  "emailCount"         INTEGER NOT NULL DEFAULT 0,
  "convertedToQuoteId" TEXT,
  "createdById"        TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Estimate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Estimate_estimateNumber_key" ON "Estimate"("estimateNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "Estimate_convertedToQuoteId_key" ON "Estimate"("convertedToQuoteId");
CREATE INDEX IF NOT EXISTS "Estimate_primeContractorId_idx" ON "Estimate"("primeContractorId");
CREATE INDEX IF NOT EXISTS "Estimate_projectId_idx" ON "Estimate"("projectId");
CREATE INDEX IF NOT EXISTS "Estimate_status_idx" ON "Estimate"("status");

-- EstimateItem -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "EstimateItem" (
  "id"                 TEXT NOT NULL,
  "estimateId"         TEXT NOT NULL,
  "description"        TEXT NOT NULL,
  "quantity"           DOUBLE PRECISION NOT NULL DEFAULT 1,
  "unit"               TEXT,
  "unitPrice"          INTEGER NOT NULL DEFAULT 0,
  "amount"             INTEGER NOT NULL DEFAULT 0,
  "jobCode"            TEXT,
  "priceBookId"        TEXT,
  "priceBookVersionId" TEXT,
  "sortOrder"          INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "EstimateItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EstimateItem_estimateId_idx" ON "EstimateItem"("estimateId");

-- Quote --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Quote" (
  "id"                 TEXT NOT NULL,
  "quoteNumber"        TEXT NOT NULL,
  "primeContractorId"  TEXT NOT NULL,
  "projectId"          TEXT,
  "salespersonId"      TEXT,
  "sourceEstimateId"   TEXT,
  "title"              TEXT,
  "status"             "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
  "issueDate"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expirationDate"     TIMESTAMP(3),
  "subtotal"           INTEGER NOT NULL DEFAULT 0,
  "taxRate"            DOUBLE PRECISION NOT NULL DEFAULT 0,
  "taxAmount"          INTEGER NOT NULL DEFAULT 0,
  "total"              INTEGER NOT NULL DEFAULT 0,
  "terms"              TEXT,
  "exclusions"         TEXT,
  "notes"              TEXT,
  "currentRevision"    INTEGER NOT NULL DEFAULT 0,
  "lastEmailedAt"      TIMESTAMP(3),
  "emailCount"         INTEGER NOT NULL DEFAULT 0,
  "viewedAt"           TIMESTAMP(3),
  "acceptedAt"         TIMESTAMP(3),
  "acceptedByName"     TEXT,
  "acceptedByEmail"    TEXT,
  "acceptanceNote"     TEXT,
  "rejectedAt"         TIMESTAMP(3),
  "rejectionReason"    TEXT,
  "convertedToJobId"   TEXT,
  "priceBookId"        TEXT,
  "priceBookVersionId" TEXT,
  "createdById"        TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Quote_quoteNumber_key" ON "Quote"("quoteNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "Quote_convertedToJobId_key" ON "Quote"("convertedToJobId");
CREATE INDEX IF NOT EXISTS "Quote_primeContractorId_idx" ON "Quote"("primeContractorId");
CREATE INDEX IF NOT EXISTS "Quote_projectId_idx" ON "Quote"("projectId");
CREATE INDEX IF NOT EXISTS "Quote_salespersonId_idx" ON "Quote"("salespersonId");
CREATE INDEX IF NOT EXISTS "Quote_status_idx" ON "Quote"("status");

-- QuoteItem ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "QuoteItem" (
  "id"                 TEXT NOT NULL,
  "quoteId"            TEXT NOT NULL,
  "description"        TEXT NOT NULL,
  "quantity"           DOUBLE PRECISION NOT NULL DEFAULT 1,
  "unit"               TEXT,
  "unitPrice"          INTEGER NOT NULL DEFAULT 0,
  "amount"             INTEGER NOT NULL DEFAULT 0,
  "jobCode"            TEXT,
  "priceBookId"        TEXT,
  "priceBookVersionId" TEXT,
  "sortOrder"          INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "QuoteItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "QuoteItem_quoteId_idx" ON "QuoteItem"("quoteId");

-- DocumentRevision ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS "DocumentRevision" (
  "id"           TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "documentId"   TEXT NOT NULL,
  "revision"     INTEGER NOT NULL,
  "snapshot"     JSONB NOT NULL,
  "createdById"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentRevision_documentType_documentId_revision_key" ON "DocumentRevision"("documentType","documentId","revision");
CREATE INDEX IF NOT EXISTS "DocumentRevision_documentType_documentId_idx" ON "DocumentRevision"("documentType","documentId");

-- DocumentSend -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "DocumentSend" (
  "id"                TEXT NOT NULL,
  "documentType"      TEXT NOT NULL,
  "documentId"        TEXT NOT NULL,
  "revisionId"        TEXT,
  "toAddress"         TEXT NOT NULL,
  "ccAddress"         TEXT,
  "bccAddress"        TEXT,
  "subject"           TEXT,
  "sentById"          TEXT,
  "provider"          TEXT,
  "providerMessageId" TEXT,
  "success"           BOOLEAN NOT NULL DEFAULT false,
  "failureCategory"   TEXT,
  "failureMessage"    TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentSend_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DocumentSend_documentType_documentId_idx" ON "DocumentSend"("documentType","documentId");
CREATE INDEX IF NOT EXISTS "DocumentSend_createdAt_idx" ON "DocumentSend"("createdAt");

-- Foreign keys (guarded) ---------------------------------------------------
DO $$ BEGIN
  ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_primeContractorId_fkey" FOREIGN KEY ("primeContractorId") REFERENCES "PrimeContractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "EstimateItem" ADD CONSTRAINT "EstimateItem_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "Quote" ADD CONSTRAINT "Quote_primeContractorId_fkey" FOREIGN KEY ("primeContractorId") REFERENCES "PrimeContractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "Quote" ADD CONSTRAINT "Quote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "Quote" ADD CONSTRAINT "Quote_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "Salesperson"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "DocumentSend" ADD CONSTRAINT "DocumentSend_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "DocumentRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Seed counters ------------------------------------------------------------
INSERT INTO "DocumentCounter" ("key","prefix","value","padding","updatedAt") VALUES
  ('ESTIMATE','EST',0,5,CURRENT_TIMESTAMP),
  ('QUOTE','Q',0,5,CURRENT_TIMESTAMP),
  ('INVOICE','INV',0,5,CURRENT_TIMESTAMP),
  ('WORKORDER','WO',0,5,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
