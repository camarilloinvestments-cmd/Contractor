-- Cold-review corrective pass (additive, backward-compatible).
-- Adds upload reservation, timezone/geocode settings, timestamp columns.
-- No existing table, column, or row is altered or dropped.

-- WatermarkSettings: add fieldTimezone + geocodeProvider columns.
ALTER TABLE "WatermarkSettings" ADD COLUMN IF NOT EXISTS "fieldTimezone" TEXT NOT NULL DEFAULT 'America/Chicago';
ALTER TABLE "WatermarkSettings" ADD COLUMN IF NOT EXISTS "geocodeProvider" TEXT NOT NULL DEFAULT 'nominatim';

-- FieldPhotoEvidence: add uploadedAt, addressLookupAt, addressProvider.
ALTER TABLE "FieldPhotoEvidence" ADD COLUMN IF NOT EXISTS "uploadedAt" TIMESTAMP(3);
ALTER TABLE "FieldPhotoEvidence" ADD COLUMN IF NOT EXISTS "addressLookupAt" TIMESTAMP(3);
ALTER TABLE "FieldPhotoEvidence" ADD COLUMN IF NOT EXISTS "addressProvider" TEXT;

-- Evidence upload reservation table.
CREATE TABLE IF NOT EXISTS "EvidenceUploadReservation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "contentType" TEXT NOT NULL DEFAULT 'image/jpeg',
  "maxSizeBytes" INTEGER NOT NULL DEFAULT 20971520,
  "consumed" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvidenceUploadReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EvidenceUploadReservation_storagePath_key" ON "EvidenceUploadReservation"("storagePath");
CREATE INDEX IF NOT EXISTS "EvidenceUploadReservation_userId_idx" ON "EvidenceUploadReservation"("userId");
CREATE INDEX IF NOT EXISTS "EvidenceUploadReservation_expiresAt_idx" ON "EvidenceUploadReservation"("expiresAt");
