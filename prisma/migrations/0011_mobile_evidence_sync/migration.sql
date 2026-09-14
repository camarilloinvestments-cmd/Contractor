-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('IOS', 'ANDROID', 'WEB');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "SyncEntityType" AS ENUM ('GPS', 'TASK_UPDATE', 'PRODUCTION', 'NOTE', 'EVIDENCE', 'PHOTO', 'DOCUMENT', 'SIGNATURE');

-- CreateEnum
CREATE TYPE "SyncResult" AS ENUM ('ACCEPTED', 'DUPLICATE', 'CONFLICT', 'REJECTED');

-- CreateEnum
CREATE TYPE "GeofenceStatus" AS ENUM ('INSIDE', 'OUTSIDE', 'UNKNOWN', 'NO_GEOFENCE');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('PHOTO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('SUBMITTED', 'ACCEPTED', 'FLAGGED');

-- CreateTable
CREATE TABLE "MobileDevice" (
    "id" TEXT NOT NULL,
    "deviceUuid" TEXT NOT NULL,
    "workerId" TEXT,
    "userId" TEXT,
    "platform" "DevicePlatform" NOT NULL DEFAULT 'ANDROID',
    "deviceName" TEXT,
    "deviceModel" TEXT,
    "osVersion" TEXT,
    "appVersion" TEXT,
    "pushToken" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSeenAt" TIMESTAMP(3),
    "lastIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "MobileDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "workerId" TEXT,
    "userId" TEXT,
    "mfaVerified" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "MobileSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileSyncEvent" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT,
    "workerId" TEXT,
    "localUuid" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "entityType" "SyncEntityType" NOT NULL,
    "result" "SyncResult" NOT NULL DEFAULT 'ACCEPTED',
    "serverEntityId" TEXT,
    "conflictStatus" TEXT,
    "deviceTimestamp" TIMESTAMP(3),
    "createdTimestamp" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileSyncEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldEvidencePackage" (
    "id" TEXT NOT NULL,
    "localUuid" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "taskId" TEXT,
    "workerId" TEXT,
    "crewId" TEXT,
    "subcontractorName" TEXT,
    "deviceId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "gpsAccuracyMeters" DOUBLE PRECISION,
    "geofenceStatus" "GeofenceStatus" NOT NULL DEFAULT 'UNKNOWN',
    "geofenceDistanceFeet" DOUBLE PRECISION,
    "productionQuantity" DOUBLE PRECISION,
    "productionUnit" TEXT,
    "notes" TEXT,
    "signatureStoragePath" TEXT,
    "signatureContentType" TEXT,
    "signedByName" TEXT,
    "capturedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "EvidenceStatus" NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldEvidencePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceAsset" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "localUuid" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL DEFAULT 'PHOTO',
    "cloudStoragePath" TEXT NOT NULL,
    "contentType" TEXT,
    "fileName" TEXT,
    "sizeBytes" INTEGER,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MobileDevice_deviceUuid_key" ON "MobileDevice"("deviceUuid");

-- CreateIndex
CREATE INDEX "MobileDevice_workerId_idx" ON "MobileDevice"("workerId");

-- CreateIndex
CREATE INDEX "MobileDevice_status_idx" ON "MobileDevice"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MobileSession_tokenHash_key" ON "MobileSession"("tokenHash");

-- CreateIndex
CREATE INDEX "MobileSession_deviceId_idx" ON "MobileSession"("deviceId");

-- CreateIndex
CREATE INDEX "MobileSession_workerId_idx" ON "MobileSession"("workerId");

-- CreateIndex
CREATE UNIQUE INDEX "MobileSyncEvent_idempotencyKey_key" ON "MobileSyncEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MobileSyncEvent_workerId_idx" ON "MobileSyncEvent"("workerId");

-- CreateIndex
CREATE INDEX "MobileSyncEvent_entityType_idx" ON "MobileSyncEvent"("entityType");

-- CreateIndex
CREATE UNIQUE INDEX "MobileSyncEvent_deviceId_localUuid_key" ON "MobileSyncEvent"("deviceId", "localUuid");

-- CreateIndex
CREATE UNIQUE INDEX "FieldEvidencePackage_localUuid_key" ON "FieldEvidencePackage"("localUuid");

-- CreateIndex
CREATE INDEX "FieldEvidencePackage_jobId_idx" ON "FieldEvidencePackage"("jobId");

-- CreateIndex
CREATE INDEX "FieldEvidencePackage_taskId_idx" ON "FieldEvidencePackage"("taskId");

-- CreateIndex
CREATE INDEX "FieldEvidencePackage_workerId_idx" ON "FieldEvidencePackage"("workerId");

-- CreateIndex
CREATE INDEX "FieldEvidencePackage_status_idx" ON "FieldEvidencePackage"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceAsset_localUuid_key" ON "EvidenceAsset"("localUuid");

-- CreateIndex
CREATE INDEX "EvidenceAsset_packageId_idx" ON "EvidenceAsset"("packageId");

-- AddForeignKey
ALTER TABLE "MobileDevice" ADD CONSTRAINT "MobileDevice_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileDevice" ADD CONSTRAINT "MobileDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileSession" ADD CONSTRAINT "MobileSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "MobileDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileSession" ADD CONSTRAINT "MobileSession_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileSession" ADD CONSTRAINT "MobileSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileSyncEvent" ADD CONSTRAINT "MobileSyncEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "MobileDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldEvidencePackage" ADD CONSTRAINT "FieldEvidencePackage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldEvidencePackage" ADD CONSTRAINT "FieldEvidencePackage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldEvidencePackage" ADD CONSTRAINT "FieldEvidencePackage_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldEvidencePackage" ADD CONSTRAINT "FieldEvidencePackage_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldEvidencePackage" ADD CONSTRAINT "FieldEvidencePackage_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "MobileDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceAsset" ADD CONSTRAINT "EvidenceAsset_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "FieldEvidencePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

