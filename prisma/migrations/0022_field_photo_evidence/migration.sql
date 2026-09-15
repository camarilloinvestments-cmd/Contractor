-- Field Photo GPS / Logo Watermark Evidence (additive, backward-compatible).
-- Adds a dedicated evidence model + watermark settings singleton. No existing
-- table, column, or row is altered or dropped. Safe to run against production.

-- Watermark / GPS policy settings (singleton row id='default').
CREATE TABLE IF NOT EXISTS "WatermarkSettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "showLogo" BOOLEAN NOT NULL DEFAULT true,
  "showCompanyName" BOOLEAN NOT NULL DEFAULT true,
  "showWorkOrder" BOOLEAN NOT NULL DEFAULT true,
  "showProject" BOOLEAN NOT NULL DEFAULT true,
  "showTaskCode" BOOLEAN NOT NULL DEFAULT true,
  "showTechnician" BOOLEAN NOT NULL DEFAULT true,
  "showGpsCoords" BOOLEAN NOT NULL DEFAULT true,
  "showGpsAccuracy" BOOLEAN NOT NULL DEFAULT true,
  "showAddress" BOOLEAN NOT NULL DEFAULT true,
  "showDate" BOOLEAN NOT NULL DEFAULT true,
  "showTime" BOOLEAN NOT NULL DEFAULT true,
  "showCompassHeading" BOOLEAN NOT NULL DEFAULT false,
  "showPhotoReference" BOOLEAN NOT NULL DEFAULT true,
  "position" TEXT NOT NULL DEFAULT 'BOTTOM',
  "opacityPercent" INTEGER NOT NULL DEFAULT 55,
  "gpsPolicy" TEXT NOT NULL DEFAULT 'REQUIRED',
  "maxAccuracyMeters" INTEGER NOT NULL DEFAULT 30,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WatermarkSettings_pkey" PRIMARY KEY ("id")
);

-- Field photo evidence records.
CREATE TABLE IF NOT EXISTS "FieldPhotoEvidence" (
  "id" TEXT NOT NULL,
  "evidenceRef" TEXT NOT NULL,
  "localUuid" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "taskId" TEXT,
  "capturedByUserId" TEXT NOT NULL,
  "projectId" TEXT,
  "primeContractorId" TEXT,
  "deviceId" TEXT,
  "technicianName" TEXT,
  "originalStoragePath" TEXT NOT NULL,
  "originalSha256" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "originalContentType" TEXT NOT NULL,
  "originalSizeBytes" INTEGER NOT NULL,
  "watermarkedStoragePath" TEXT,
  "watermarkedSha256" TEXT,
  "watermarkedContentType" TEXT,
  "watermarkGeneratedAt" TIMESTAMP(3),
  "watermarkError" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "gpsAccuracyMeters" DOUBLE PRECISION,
  "altitude" DOUBLE PRECISION,
  "heading" DOUBLE PRECISION,
  "speed" DOUBLE PRECISION,
  "locationCapturedAt" TIMESTAMP(3),
  "address" TEXT,
  "accuracyClass" TEXT,
  "gpsPolicyAtCapture" TEXT,
  "correctedLatitude" DOUBLE PRECISION,
  "correctedLongitude" DOUBLE PRECISION,
  "correctionReason" TEXT,
  "correctedByUserId" TEXT,
  "correctedAt" TIMESTAMP(3),
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'UPLOADED',
  "notes" TEXT,
  "supersedesId" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FieldPhotoEvidence_pkey" PRIMARY KEY ("id")
);

-- Unique constraints.
CREATE UNIQUE INDEX IF NOT EXISTS "FieldPhotoEvidence_evidenceRef_key" ON "FieldPhotoEvidence"("evidenceRef");
CREATE UNIQUE INDEX IF NOT EXISTS "FieldPhotoEvidence_localUuid_key" ON "FieldPhotoEvidence"("localUuid");

-- Lookup indexes.
CREATE INDEX IF NOT EXISTS "FieldPhotoEvidence_jobId_idx" ON "FieldPhotoEvidence"("jobId");
CREATE INDEX IF NOT EXISTS "FieldPhotoEvidence_taskId_idx" ON "FieldPhotoEvidence"("taskId");
CREATE INDEX IF NOT EXISTS "FieldPhotoEvidence_capturedByUserId_idx" ON "FieldPhotoEvidence"("capturedByUserId");
CREATE INDEX IF NOT EXISTS "FieldPhotoEvidence_status_idx" ON "FieldPhotoEvidence"("status");
CREATE INDEX IF NOT EXISTS "FieldPhotoEvidence_capturedAt_idx" ON "FieldPhotoEvidence"("capturedAt");

-- Foreign keys (guarded so re-runs never error).
DO $$ BEGIN
  ALTER TABLE "FieldPhotoEvidence" ADD CONSTRAINT "FieldPhotoEvidence_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "FieldPhotoEvidence" ADD CONSTRAINT "FieldPhotoEvidence_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "FieldPhotoEvidence" ADD CONSTRAINT "FieldPhotoEvidence_capturedByUserId_fkey"
    FOREIGN KEY ("capturedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "FieldPhotoEvidence" ADD CONSTRAINT "FieldPhotoEvidence_supersedesId_fkey"
    FOREIGN KEY ("supersedesId") REFERENCES "FieldPhotoEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed the photo-evidence sequence counter (EV-000001 style) if absent.
INSERT INTO "DocumentCounter" ("key", "prefix", "value", "padding", "updatedAt")
VALUES ('PHOTO_EVIDENCE', 'EV', 0, 6, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
