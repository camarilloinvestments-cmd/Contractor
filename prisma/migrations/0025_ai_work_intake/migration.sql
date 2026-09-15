-- AI Help — OpenAI Work Intake (isolated, additive-only).
-- All statements are additive: new enum + new tables only. No drops, no
-- alterations to existing/frozen tables. Safe to run on a populated database.

-- Enum -----------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "AiIntakeStatus" AS ENUM ('NEW','ANALYZING','NEEDS_REVIEW','READY','APPROVED','IMPORTED','REJECTED','FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AiIntakeSettings (singleton) ----------------------------------------------
CREATE TABLE IF NOT EXISTS "AiIntakeSettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "apiKeyEncrypted" TEXT,
  "apiBase" TEXT DEFAULT 'https://api.openai.com/v1',
  "normalModel" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  "fallbackModel" TEXT NOT NULL DEFAULT 'gpt-4o',
  "schemaVersion" TEXT NOT NULL DEFAULT '1',
  "lastSuccessAt" TIMESTAMP(3),
  "lastModelUsed" TEXT,
  "lastError" TEXT,
  "lastErrorAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiIntakeSettings_pkey" PRIMARY KEY ("id")
);

-- AiWorkIntake ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "AiWorkIntake" (
  "id" TEXT NOT NULL,
  "intakeNumber" TEXT NOT NULL,
  "status" "AiIntakeStatus" NOT NULL DEFAULT 'NEW',
  "primeContractorId" TEXT NOT NULL,
  "projectId" TEXT,
  "title" TEXT,
  "pastedText" TEXT,
  "model" TEXT,
  "modelUsed" TEXT,
  "usedFallback" BOOLEAN NOT NULL DEFAULT false,
  "schemaVersion" TEXT,
  "structuredDraft" JSONB,
  "priorityRawText" TEXT,
  "priorityOrder" JSONB,
  "warnings" JSONB,
  "confidenceSummary" JSONB,
  "error" TEXT,
  "analyzedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedById" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "resultingJobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiWorkIntake_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AiWorkIntake_intakeNumber_key" ON "AiWorkIntake"("intakeNumber");
CREATE INDEX IF NOT EXISTS "AiWorkIntake_status_idx" ON "AiWorkIntake"("status");
CREATE INDEX IF NOT EXISTS "AiWorkIntake_primeContractorId_idx" ON "AiWorkIntake"("primeContractorId");
CREATE INDEX IF NOT EXISTS "AiWorkIntake_projectId_idx" ON "AiWorkIntake"("projectId");
CREATE INDEX IF NOT EXISTS "AiWorkIntake_createdById_idx" ON "AiWorkIntake"("createdById");
CREATE INDEX IF NOT EXISTS "AiWorkIntake_resultingJobId_idx" ON "AiWorkIntake"("resultingJobId");

-- AiIntakeSource -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "AiIntakeSource" (
  "id" TEXT NOT NULL,
  "intakeId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "originalFilename" TEXT,
  "contentType" TEXT,
  "storagePath" TEXT,
  "sizeBytes" INTEGER,
  "sha256" TEXT,
  "sentToAi" BOOLEAN NOT NULL DEFAULT false,
  "extractionInfo" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiIntakeSource_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AiIntakeSource_intakeId_idx" ON "AiIntakeSource"("intakeId");

-- AiIntakeItem ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "AiIntakeItem" (
  "id" TEXT NOT NULL,
  "intakeId" TEXT NOT NULL,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "deviceId" TEXT NOT NULL,
  "proposedType" TEXT,
  "routeSection" TEXT,
  "instructions" TEXT,
  "reentryRequired" BOOLEAN NOT NULL DEFAULT false,
  "reentryReason" TEXT,
  "partialWorkAllowed" BOOLEAN NOT NULL DEFAULT false,
  "blockedDependency" TEXT,
  "dependencies" JSONB,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "requiresReview" BOOLEAN NOT NULL DEFAULT false,
  "reviewReason" TEXT,
  "sourceReference" TEXT,
  "possibleDuplicate" BOOLEAN NOT NULL DEFAULT false,
  "duplicateOfJobId" TEXT,
  "proposedBillingCode" TEXT,
  "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "mappedTaskTypeId" TEXT,
  "confirmedJobCode" TEXT,
  "quantity" DOUBLE PRECISION,
  "resultingTaskId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiIntakeItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AiIntakeItem_intakeId_idx" ON "AiIntakeItem"("intakeId");
CREATE INDEX IF NOT EXISTS "AiIntakeItem_deviceId_idx" ON "AiIntakeItem"("deviceId");

-- PrimeProjectAiRule ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS "PrimeProjectAiRule" (
  "id" TEXT NOT NULL,
  "primeContractorId" TEXT NOT NULL,
  "projectId" TEXT,
  "ruleType" TEXT NOT NULL,
  "term" TEXT NOT NULL,
  "definition" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrimeProjectAiRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PrimeProjectAiRule_primeContractorId_projectId_ruleType_term_key" ON "PrimeProjectAiRule"("primeContractorId","projectId","ruleType","term");
CREATE INDEX IF NOT EXISTS "PrimeProjectAiRule_primeContractorId_idx" ON "PrimeProjectAiRule"("primeContractorId");
CREATE INDEX IF NOT EXISTS "PrimeProjectAiRule_projectId_idx" ON "PrimeProjectAiRule"("projectId");

-- Foreign keys (only among the NEW isolated tables) --------------------------
DO $$ BEGIN
  ALTER TABLE "AiIntakeSource" ADD CONSTRAINT "AiIntakeSource_intakeId_fkey"
    FOREIGN KEY ("intakeId") REFERENCES "AiWorkIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "AiIntakeItem" ADD CONSTRAINT "AiIntakeItem_intakeId_fkey"
    FOREIGN KEY ("intakeId") REFERENCES "AiWorkIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
