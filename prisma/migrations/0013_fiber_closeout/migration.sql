-- CreateEnum
CREATE TYPE "DocWorkflowStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CloseoutStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED');

-- CreateEnum
CREATE TYPE "CablePlacement" AS ENUM ('AERIAL', 'UNDERGROUND', 'UNKNOWN');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "documentationWorkflowVersionId" TEXT;

-- CreateTable
CREATE TABLE "DocumentationWorkflow" (
    "id" TEXT NOT NULL,
    "primeContractorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workType" TEXT,
    "projectType" TEXT,
    "status" "DocWorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentationWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentationWorkflowVersion" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "DocWorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "config" JSONB NOT NULL,
    "requireCloseoutBeforeInvoice" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentationWorkflowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cable" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fiberCount" INTEGER NOT NULL DEFAULT 0,
    "cableType" TEXT,
    "reelNumber" TEXT,
    "manufacturer" TEXT,
    "lengthValue" DOUBLE PRECISION,
    "lengthUnit" TEXT DEFAULT 'FT',
    "placement" "CablePlacement" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiberPosition" (
    "id" TEXT NOT NULL,
    "cableId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "binderColor" TEXT NOT NULL,
    "fiberColor" TEXT NOT NULL,

    CONSTRAINT "FiberPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SplicePoint" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "closureType" TEXT,
    "closureId" TEXT,
    "address" TEXT,
    "poleNumber" TEXT,
    "placement" "CablePlacement" NOT NULL DEFAULT 'UNKNOWN',
    "trayCount" INTEGER,
    "hexMap" TEXT,
    "splicer" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SplicePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Port" (
    "id" TEXT NOT NULL,
    "splicePointId" TEXT NOT NULL,
    "portNumber" INTEGER NOT NULL,
    "cableId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Port_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiberMapping" (
    "id" TEXT NOT NULL,
    "splicePointId" TEXT NOT NULL,
    "inPortId" TEXT,
    "inFiberPositionId" TEXT,
    "outPortId" TEXT,
    "outFiberPositionId" TEXT,
    "spliceType" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiberMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloseoutRevision" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "CloseoutStatus" NOT NULL DEFAULT 'DRAFT',
    "workflowVersionId" TEXT,
    "workbookPath" TEXT,
    "kmzPath" TEXT,
    "zipPath" TEXT,
    "summaryPdfPath" TEXT,
    "manifest" JSONB,
    "generatedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CloseoutRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentationWorkflow_primeContractorId_idx" ON "DocumentationWorkflow"("primeContractorId");

-- CreateIndex
CREATE INDEX "DocumentationWorkflow_status_idx" ON "DocumentationWorkflow"("status");

-- CreateIndex
CREATE INDEX "DocumentationWorkflowVersion_workflowId_idx" ON "DocumentationWorkflowVersion"("workflowId");

-- CreateIndex
CREATE INDEX "DocumentationWorkflowVersion_status_idx" ON "DocumentationWorkflowVersion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentationWorkflowVersion_workflowId_version_key" ON "DocumentationWorkflowVersion"("workflowId", "version");

-- CreateIndex
CREATE INDEX "Cable_jobId_idx" ON "Cable"("jobId");

-- CreateIndex
CREATE INDEX "FiberPosition_cableId_idx" ON "FiberPosition"("cableId");

-- CreateIndex
CREATE UNIQUE INDEX "FiberPosition_cableId_position_key" ON "FiberPosition"("cableId", "position");

-- CreateIndex
CREATE INDEX "SplicePoint_jobId_idx" ON "SplicePoint"("jobId");

-- CreateIndex
CREATE INDEX "Port_splicePointId_idx" ON "Port"("splicePointId");

-- CreateIndex
CREATE INDEX "Port_cableId_idx" ON "Port"("cableId");

-- CreateIndex
CREATE UNIQUE INDEX "Port_splicePointId_portNumber_key" ON "Port"("splicePointId", "portNumber");

-- CreateIndex
CREATE INDEX "FiberMapping_splicePointId_idx" ON "FiberMapping"("splicePointId");

-- CreateIndex
CREATE INDEX "CloseoutRevision_jobId_idx" ON "CloseoutRevision"("jobId");

-- CreateIndex
CREATE INDEX "CloseoutRevision_status_idx" ON "CloseoutRevision"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CloseoutRevision_jobId_revision_key" ON "CloseoutRevision"("jobId", "revision");

-- CreateIndex
CREATE INDEX "Job_documentationWorkflowVersionId_idx" ON "Job"("documentationWorkflowVersionId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_documentationWorkflowVersionId_fkey" FOREIGN KEY ("documentationWorkflowVersionId") REFERENCES "DocumentationWorkflowVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentationWorkflow" ADD CONSTRAINT "DocumentationWorkflow_primeContractorId_fkey" FOREIGN KEY ("primeContractorId") REFERENCES "PrimeContractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentationWorkflowVersion" ADD CONSTRAINT "DocumentationWorkflowVersion_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "DocumentationWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cable" ADD CONSTRAINT "Cable_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiberPosition" ADD CONSTRAINT "FiberPosition_cableId_fkey" FOREIGN KEY ("cableId") REFERENCES "Cable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SplicePoint" ADD CONSTRAINT "SplicePoint_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Port" ADD CONSTRAINT "Port_splicePointId_fkey" FOREIGN KEY ("splicePointId") REFERENCES "SplicePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Port" ADD CONSTRAINT "Port_cableId_fkey" FOREIGN KEY ("cableId") REFERENCES "Cable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiberMapping" ADD CONSTRAINT "FiberMapping_splicePointId_fkey" FOREIGN KEY ("splicePointId") REFERENCES "SplicePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiberMapping" ADD CONSTRAINT "FiberMapping_inPortId_fkey" FOREIGN KEY ("inPortId") REFERENCES "Port"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiberMapping" ADD CONSTRAINT "FiberMapping_inFiberPositionId_fkey" FOREIGN KEY ("inFiberPositionId") REFERENCES "FiberPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiberMapping" ADD CONSTRAINT "FiberMapping_outPortId_fkey" FOREIGN KEY ("outPortId") REFERENCES "Port"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiberMapping" ADD CONSTRAINT "FiberMapping_outFiberPositionId_fkey" FOREIGN KEY ("outFiberPositionId") REFERENCES "FiberPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloseoutRevision" ADD CONSTRAINT "CloseoutRevision_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

