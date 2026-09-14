-- CreateEnum
CREATE TYPE "ReleaseChannel" AS ENUM ('STABLE', 'RC', 'BETA');

-- CreateEnum
CREATE TYPE "UpdateAction" AS ENUM ('CHECK', 'DOWNLOAD', 'INSTALL', 'ROLLBACK', 'UPLOAD', 'RETRY');

-- CreateEnum
CREATE TYPE "UpdateResult" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCESS', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "UpdateSource" AS ENUM ('GITHUB', 'MANUAL');

-- CreateTable
CREATE TABLE "UpdateSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "releaseChannel" "ReleaseChannel" NOT NULL DEFAULT 'RC',
    "githubOwner" TEXT,
    "githubRepo" TEXT,
    "githubTokenEncrypted" TEXT,
    "autoCheck" BOOLEAN NOT NULL DEFAULT false,
    "publicKeyPem" TEXT,
    "requireSignature" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "latestVersion" TEXT,
    "latestReleaseAt" TIMESTAMP(3),
    "latestCommit" TEXT,
    "latestPackageBytes" INTEGER,
    "latestReleaseNotes" TEXT,
    "latestAssetName" TEXT,
    "latestAssetSha256" TEXT,
    "lastCheckAt" TIMESTAMP(3),
    "lastCheckStatus" TEXT,
    "lastCheckError" TEXT,
    "lastSuccessfulUpdateAt" TIMESTAMP(3),
    "lastFailedUpdateAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpdateSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdateHistory" (
    "id" TEXT NOT NULL,
    "action" "UpdateAction" NOT NULL,
    "source" "UpdateSource" NOT NULL DEFAULT 'GITHUB',
    "fromVersion" TEXT,
    "toVersion" TEXT,
    "commit" TEXT,
    "result" "UpdateResult" NOT NULL DEFAULT 'PENDING',
    "rollbackResult" TEXT,
    "installedBy" TEXT,
    "message" TEXT,
    "logs" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpdateHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UpdateHistory_action_createdAt_idx" ON "UpdateHistory"("action", "createdAt");

-- CreateIndex
CREATE INDEX "UpdateHistory_result_idx" ON "UpdateHistory"("result");

