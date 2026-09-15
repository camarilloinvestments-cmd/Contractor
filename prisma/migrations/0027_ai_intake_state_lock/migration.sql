-- AI Intake final state-lock correction (additive-only, backward-compatible).
-- Adds a monotonic `revision` mutation counter to AiWorkIntake. Every
-- state-locked draft/source edit and every analysis/approval claim performs a
-- conditional update on the parent AiWorkIntake row (incrementing this counter),
-- which takes the SAME row lock, so PATCH/source edits and analysis/approval
-- claims serialize against each other and cannot both believe they own the
-- intake simultaneously (closes the remaining TOCTOU family).
--
-- Idempotent (IF NOT EXISTS) and non-destructive; DEFAULT 0 backfills every
-- existing row. Safe on a populated database.

ALTER TABLE "AiWorkIntake" ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 0;
