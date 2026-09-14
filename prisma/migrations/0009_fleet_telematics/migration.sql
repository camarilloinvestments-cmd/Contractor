-- CreateEnum
CREATE TYPE "LocationSource" AS ENUM ('MOBILE_APP', 'GEOTAB', 'JOB_SITE', 'MANUAL', 'OTHER_FLEET_PROVIDER');

-- CreateEnum
CREATE TYPE "FleetProviderType" AS ENUM ('GEOTAB');

-- CreateEnum
CREATE TYPE "VehicleMotion" AS ENUM ('DRIVING', 'STOPPED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "GeoEventType" AS ENUM ('WORKER_ARRIVED', 'WORKER_LEFT', 'VEHICLE_ARRIVED', 'VEHICLE_LEFT');

-- CreateEnum
CREATE TYPE "GeoActorType" AS ENUM ('WORKER', 'VEHICLE');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "geofenceRadiusFeet" INTEGER;

-- AlterTable
ALTER TABLE "Worker" ADD COLUMN     "crewId" TEXT;

-- CreateTable
CREATE TABLE "Crew" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subcontractorCompany" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Crew_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetProviderSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "provider" "FleetProviderType" NOT NULL DEFAULT 'GEOTAB',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "database" TEXT,
    "username" TEXT,
    "credentialEncrypted" TEXT,
    "sessionIdEncrypted" TEXT,
    "serverUrl" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "lastConnectionStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetProviderSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetFeedState" (
    "id" TEXT NOT NULL,
    "provider" "FleetProviderType" NOT NULL DEFAULT 'GEOTAB',
    "dataType" TEXT NOT NULL,
    "fromVersion" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetFeedState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetVehicle" (
    "id" TEXT NOT NULL,
    "provider" "FleetProviderType" NOT NULL DEFAULT 'GEOTAB',
    "geotabDeviceId" TEXT,
    "name" TEXT NOT NULL,
    "vehicleNumber" TEXT,
    "vin" TEXT,
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "licensePlate" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assignedCrewId" TEXT,
    "assignedWorkerId" TEXT,
    "subcontractorCompany" TEXT,
    "currentJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleState" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "speed" DOUBLE PRECISION,
    "bearing" DOUBLE PRECISION,
    "motion" "VehicleMotion" NOT NULL DEFAULT 'UNKNOWN',
    "communicating" BOOLEAN NOT NULL DEFAULT true,
    "currentDriverName" TEXT,
    "currentJobId" TEXT,
    "lastUpdateAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleTelemetry" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "source" "LocationSource" NOT NULL DEFAULT 'GEOTAB',
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION,
    "bearing" DOUBLE PRECISION,
    "driverName" TEXT,
    "jobId" TEXT,
    "crewId" TEXT,
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleTelemetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleTrip" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "source" "LocationSource" NOT NULL DEFAULT 'GEOTAB',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "startLat" DOUBLE PRECISION,
    "startLng" DOUBLE PRECISION,
    "endLat" DOUBLE PRECISION,
    "endLng" DOUBLE PRECISION,
    "distanceMeters" DOUBLE PRECISION,
    "drivingSeconds" INTEGER,
    "odometerMeters" DOUBLE PRECISION,
    "engineHours" DOUBLE PRECISION,
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerLocation" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "source" "LocationSource" NOT NULL DEFAULT 'MOBILE_APP',
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoEvent" (
    "id" TEXT NOT NULL,
    "eventType" "GeoEventType" NOT NULL,
    "actorType" "GeoActorType" NOT NULL,
    "jobId" TEXT NOT NULL,
    "workerId" TEXT,
    "vehicleId" TEXT,
    "crewId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "source" "LocationSource" NOT NULL,
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Crew_active_idx" ON "Crew"("active");

-- CreateIndex
CREATE UNIQUE INDEX "FleetFeedState_provider_dataType_key" ON "FleetFeedState"("provider", "dataType");

-- CreateIndex
CREATE INDEX "FleetVehicle_active_idx" ON "FleetVehicle"("active");

-- CreateIndex
CREATE INDEX "FleetVehicle_assignedCrewId_idx" ON "FleetVehicle"("assignedCrewId");

-- CreateIndex
CREATE INDEX "FleetVehicle_currentJobId_idx" ON "FleetVehicle"("currentJobId");

-- CreateIndex
CREATE UNIQUE INDEX "FleetVehicle_provider_geotabDeviceId_key" ON "FleetVehicle"("provider", "geotabDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleState_vehicleId_key" ON "VehicleState"("vehicleId");

-- CreateIndex
CREATE INDEX "VehicleTelemetry_vehicleId_recordedAt_idx" ON "VehicleTelemetry"("vehicleId", "recordedAt");

-- CreateIndex
CREATE INDEX "VehicleTelemetry_jobId_idx" ON "VehicleTelemetry"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleTelemetry_vehicleId_providerRef_key" ON "VehicleTelemetry"("vehicleId", "providerRef");

-- CreateIndex
CREATE INDEX "VehicleTrip_vehicleId_startAt_idx" ON "VehicleTrip"("vehicleId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleTrip_vehicleId_providerRef_key" ON "VehicleTrip"("vehicleId", "providerRef");

-- CreateIndex
CREATE INDEX "WorkerLocation_workerId_recordedAt_idx" ON "WorkerLocation"("workerId", "recordedAt");

-- CreateIndex
CREATE INDEX "WorkerLocation_jobId_idx" ON "WorkerLocation"("jobId");

-- CreateIndex
CREATE INDEX "GeoEvent_jobId_occurredAt_idx" ON "GeoEvent"("jobId", "occurredAt");

-- CreateIndex
CREATE INDEX "GeoEvent_vehicleId_occurredAt_idx" ON "GeoEvent"("vehicleId", "occurredAt");

-- CreateIndex
CREATE INDEX "GeoEvent_workerId_occurredAt_idx" ON "GeoEvent"("workerId", "occurredAt");

-- CreateIndex
CREATE INDEX "Worker_crewId_idx" ON "Worker"("crewId");

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetVehicle" ADD CONSTRAINT "FleetVehicle_assignedCrewId_fkey" FOREIGN KEY ("assignedCrewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetVehicle" ADD CONSTRAINT "FleetVehicle_assignedWorkerId_fkey" FOREIGN KEY ("assignedWorkerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetVehicle" ADD CONSTRAINT "FleetVehicle_currentJobId_fkey" FOREIGN KEY ("currentJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleState" ADD CONSTRAINT "VehicleState_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleTelemetry" ADD CONSTRAINT "VehicleTelemetry_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleTelemetry" ADD CONSTRAINT "VehicleTelemetry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleTrip" ADD CONSTRAINT "VehicleTrip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerLocation" ADD CONSTRAINT "WorkerLocation_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerLocation" ADD CONSTRAINT "WorkerLocation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoEvent" ADD CONSTRAINT "GeoEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoEvent" ADD CONSTRAINT "GeoEvent_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoEvent" ADD CONSTRAINT "GeoEvent_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoEvent" ADD CONSTRAINT "GeoEvent_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

