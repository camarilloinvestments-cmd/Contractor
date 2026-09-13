-- Workstream E: Mandatory Admin MFA / Two-Factor Authentication
-- Additive, non-destructive. Adds MFA fields to User, recovery-code and policy tables.

-- User MFA columns (all nullable or defaulted -> safe for existing rows)
ALTER TABLE "User" ADD COLUMN     "mfaEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN     "mfaSecret" TEXT;
ALTER TABLE "User" ADD COLUMN     "mfaEnrolledAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN     "mfaLastVerifiedAt" TIMESTAMP(3);

-- Hashed, single-use recovery codes (secrets stored only as hashes)
CREATE TABLE "MfaRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MfaRecoveryCode_userId_idx" ON "MfaRecoveryCode"("userId");

ALTER TABLE "MfaRecoveryCode" ADD CONSTRAINT "MfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Role-based MFA policy (ADMIN required by default)
CREATE TABLE "MfaPolicy" (
    "role" "UserRole" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MfaPolicy_pkey" PRIMARY KEY ("role")
);

-- Seed default policy: ADMIN = REQUIRED; others configurable (default off)
INSERT INTO "MfaPolicy" ("role", "required", "updatedAt") VALUES
    ('ADMIN', true, CURRENT_TIMESTAMP),
    ('PROJECT_MANAGER', false, CURRENT_TIMESTAMP),
    ('FIELD_WORKER', false, CURRENT_TIMESTAMP)
ON CONFLICT ("role") DO NOTHING;
