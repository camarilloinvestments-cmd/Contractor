-- Statements module (additive, idempotent). Creates the Statement + StatementLine
-- tables, the StatementStatus enum, and seeds the STATEMENT document counter.
-- No existing table is altered destructively.

-- Enum -------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "StatementStatus" AS ENUM ('DRAFT','SENT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Statement --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Statement" (
  "id"                TEXT NOT NULL,
  "statementNumber"   TEXT NOT NULL,
  "primeContractorId" TEXT NOT NULL,
  "projectId"         TEXT,
  "status"            "StatementStatus" NOT NULL DEFAULT 'DRAFT',
  "statementDate"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "periodStart"       TIMESTAMP(3) NOT NULL,
  "periodEnd"         TIMESTAMP(3) NOT NULL,
  "openingBalance"    INTEGER NOT NULL DEFAULT 0,
  "invoicedAmount"    INTEGER NOT NULL DEFAULT 0,
  "paymentsAmount"    INTEGER NOT NULL DEFAULT 0,
  "endingBalance"     INTEGER NOT NULL DEFAULT 0,
  "agingCurrent"      INTEGER NOT NULL DEFAULT 0,
  "aging1To30"        INTEGER NOT NULL DEFAULT 0,
  "aging31To60"       INTEGER NOT NULL DEFAULT 0,
  "aging61To90"       INTEGER NOT NULL DEFAULT 0,
  "aging91Plus"       INTEGER NOT NULL DEFAULT 0,
  "notes"             TEXT,
  "currentRevision"   INTEGER NOT NULL DEFAULT 0,
  "lastEmailedAt"     TIMESTAMP(3),
  "emailCount"        INTEGER NOT NULL DEFAULT 0,
  "createdById"       TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Statement_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  CREATE UNIQUE INDEX "Statement_statementNumber_key" ON "Statement"("statementNumber");
EXCEPTION WHEN duplicate_table THEN null; END $$;
CREATE INDEX IF NOT EXISTS "Statement_primeContractorId_idx" ON "Statement"("primeContractorId");
CREATE INDEX IF NOT EXISTS "Statement_projectId_idx" ON "Statement"("projectId");
CREATE INDEX IF NOT EXISTS "Statement_status_idx" ON "Statement"("status");

-- StatementLine ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "StatementLine" (
  "id"          TEXT NOT NULL,
  "statementId" TEXT NOT NULL,
  "lineType"    TEXT NOT NULL,
  "refId"       TEXT,
  "refNumber"   TEXT,
  "date"        TIMESTAMP(3) NOT NULL,
  "description" TEXT NOT NULL,
  "charges"     INTEGER NOT NULL DEFAULT 0,
  "credits"     INTEGER NOT NULL DEFAULT 0,
  "balance"     INTEGER NOT NULL DEFAULT 0,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "StatementLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StatementLine_statementId_idx" ON "StatementLine"("statementId");

-- Foreign keys -----------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE "Statement" ADD CONSTRAINT "Statement_primeContractorId_fkey" FOREIGN KEY ("primeContractorId") REFERENCES "PrimeContractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "Statement" ADD CONSTRAINT "Statement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "StatementLine" ADD CONSTRAINT "StatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "Statement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Seed the STATEMENT counter (STAT-00001 ...). Idempotent. -----------------------
INSERT INTO "DocumentCounter" ("key","prefix","value","padding","updatedAt") VALUES
  ('STATEMENT','STAT',0,5,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Sync to the highest existing numeric suffix so counter-allocated numbers never
-- collide with any pre-existing STAT- rows. GREATEST keeps re-runs safe.
UPDATE "DocumentCounter" c SET "value" = GREATEST(c."value", COALESCE((
  SELECT MAX(CAST(substring(s."statementNumber" from '([0-9]+)$') AS INTEGER))
  FROM "Statement" s WHERE s."statementNumber" ~ '^STAT-[0-9]+$'
), 0)) WHERE c."key" = 'STATEMENT';
