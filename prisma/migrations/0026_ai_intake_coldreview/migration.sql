-- AI Intake cold-review remediation (additive-only, backward-compatible).
-- Adds: durable non-financial work identifier on Task (Blocker 4),
-- an APPROVING claim state on AiIntakeStatus (Blocker 2 atomic approval),
-- and validated operator review-resolution fields on AiIntakeItem (Blocker 3).
-- Every statement is idempotent (IF NOT EXISTS / guarded) and non-destructive;
-- no columns are dropped or altered in an incompatible way. Safe on a populated DB.

-- Blocker 4: durable device/work identifier on Task (never a billing code) -----
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "sourceWorkRef" TEXT;
CREATE INDEX IF NOT EXISTS "Task_sourceWorkRef_idx" ON "Task"("sourceWorkRef");

-- Blocker 2: concurrency-safe claim state for approval ------------------------
-- ADD VALUE is not used within this same migration transaction, which is safe
-- on PostgreSQL 12+.
ALTER TYPE "AiIntakeStatus" ADD VALUE IF NOT EXISTS 'APPROVING';

-- Blocker 3: validated operator review resolution -----------------------------
DO $$ BEGIN
  CREATE TYPE "AiItemReviewResolution" AS ENUM ('PENDING','CONFIRMED','CORRECTED','EXCLUDED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "AiIntakeItem" ADD COLUMN IF NOT EXISTS "reviewResolution" "AiItemReviewResolution" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "AiIntakeItem" ADD COLUMN IF NOT EXISTS "reviewedById" TEXT;
ALTER TABLE "AiIntakeItem" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
ALTER TABLE "AiIntakeItem" ADD COLUMN IF NOT EXISTS "reviewNote" TEXT;
