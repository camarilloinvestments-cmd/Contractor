-- Section 25: enrich Update History with operator-facing columns.
-- All additive nullable columns; no data loss, safe on existing rows.
ALTER TABLE "UpdateHistory" ADD COLUMN IF NOT EXISTS "fromCommit" TEXT;
ALTER TABLE "UpdateHistory" ADD COLUMN IF NOT EXISTS "toCommit" TEXT;
ALTER TABLE "UpdateHistory" ADD COLUMN IF NOT EXISTS "backupResult" TEXT;
ALTER TABLE "UpdateHistory" ADD COLUMN IF NOT EXISTS "migrationsResult" TEXT;
ALTER TABLE "UpdateHistory" ADD COLUMN IF NOT EXISTS "healthResult" TEXT;
ALTER TABLE "UpdateHistory" ADD COLUMN IF NOT EXISTS "durationMs" INTEGER;
