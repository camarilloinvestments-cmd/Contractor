-- Cold-review §2: atomic reservation consumption support (additive only).
-- Adds consumedAt + evidenceId to EvidenceUploadReservation. No drops/renames.

ALTER TABLE "EvidenceUploadReservation" ADD COLUMN IF NOT EXISTS "consumedAt" TIMESTAMP(3);
ALTER TABLE "EvidenceUploadReservation" ADD COLUMN IF NOT EXISTS "evidenceId" TEXT;
