export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';
import { uploadBuffer } from '@/lib/s3';
import { getCompanyProfile } from '@/lib/branding';
import { normalizeConfig } from '@/lib/closeout/workflow-config';
import { generateCloseoutPackage, type CloseoutAsset } from '@/lib/closeout/package';
import type { Prisma } from '@prisma/client';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

// GET: list closeout revisions for a job (newest first).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const revisions = await prisma.closeoutRevision.findMany({
    where: { jobId: id },
    orderBy: { revision: 'desc' },
  });
  return NextResponse.json(revisions);
}

// POST: generate a new (immutable) closeout revision for the job.
// Builds the workbook, KMZ, evidence bundle, summary PDF and manifest, uploads
// them, and records a CloseoutRevision row. Client-safe: no payout/cost data.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await params;

  try {
    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        primeContractor: { select: { companyName: true } },
        documentationWorkflowVersion: { include: { workflow: { select: { name: true } } } },
        cables: { include: { fiberPositions: true } },
        splicePoints: { include: { mappings: true } },
        evidencePackages: { include: { assets: true } },
        fieldPhotoEvidence: {
          where: { status: 'WATERMARKED', watermarkedStoragePath: { not: null } },
          select: {
            evidenceRef: true,
            watermarkedStoragePath: true,
            watermarkedContentType: true,
          },
        },
      },
    });
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

    const versionRow = job.documentationWorkflowVersion;
    const config = normalizeConfig(versionRow?.config ?? null);
    const workflowName = versionRow?.workflow?.name ?? null;
    const workflowVersion = versionRow?.version ?? null;

    // Build per-splice-point fiber destinations from cable fiber positions.
    const cablesForPkg = job.cables.map((c) => ({
      label: c.label,
      fiberCount: c.fiberCount,
      placement: c.placement,
    }));

    const splicePoints = job.splicePoints.map((sp) => ({
      label: sp.label,
      closureType: sp.closureType,
      closureId: sp.closureId,
      address: sp.address,
      poleNumber: sp.poleNumber,
      placement: sp.placement,
      trayCount: sp.trayCount,
      hexMap: sp.hexMap,
      splicer: sp.splicer,
      latitude: sp.latitude,
      longitude: sp.longitude,
    }));

    // Evidence assets -> client-safe closeout assets (exclude flagged items).
    const assets: CloseoutAsset[] = [];
    for (const pkg of job.evidencePackages) {
      if (pkg.status === 'FLAGGED') continue;
      for (const a of pkg.assets) {
        assets.push({
          cloudStoragePath: a.cloudStoragePath,
          fileName: a.fileName ?? `${a.id}`,
          category: a.kind === 'DOCUMENT' ? 'DOCUMENT' : 'PHOTO',
          contentType: a.contentType,
        });
      }
    }

    // Field photo evidence (§13): only the WATERMARKED derivative is customer-facing.
    // The original bytes are never packaged for the client. The watermark overlay
    // carries no financial data (WO#, project, task, tech, GPS, time only).
    for (const ev of job.fieldPhotoEvidence) {
      if (!ev.watermarkedStoragePath) continue;
      assets.push({
        cloudStoragePath: ev.watermarkedStoragePath,
        fileName: `${ev.evidenceRef}.jpg`,
        category: 'PHOTO',
        contentType: ev.watermarkedContentType ?? 'image/jpeg',
      });
    }

    // Next immutable revision number.
    const last = await prisma.closeoutRevision.findFirst({
      where: { jobId: id },
      orderBy: { revision: 'desc' },
      select: { revision: true },
    });
    const revision = (last?.revision ?? 0) + 1;

    const branding = await getCompanyProfile();

    const pkg = await generateCloseoutPackage(
      {
        job: {
          jobNumber: job.jobNumber,
          title: job.jobName,
          address: job.address,
          city: job.city,
          state: job.state,
          zip: job.zip,
          latitude: job.latitude,
          longitude: job.longitude,
          primeContractorName: job.primeContractor?.companyName ?? null,
          workflowName,
          workflowVersion,
          splicePoints,
        },
        cables: cablesForPkg,
        assets,
        revision,
        config,
      },
      branding
    );

    // Upload artifacts.
    const prefix = `generated/closeout/${job.jobNumber}`;
    const [zipUp, wbUp, kmzUp, pdfUp] = await Promise.all([
      uploadBuffer(pkg.zip, pkg.zipFileName, 'application/zip', prefix),
      uploadBuffer(pkg.workbook, pkg.workbookFileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', prefix),
      config.kmz.enabled
        ? uploadBuffer(pkg.kmz, pkg.kmzFileName, 'application/vnd.google-earth.kmz', prefix)
        : Promise.resolve({ cloud_storage_path: '' }),
      uploadBuffer(pkg.summaryPdf, pkg.summaryPdfFileName, 'application/pdf', prefix),
    ]);

    const created = await prisma.closeoutRevision.create({
      data: {
        jobId: id,
        revision,
        status: 'SUBMITTED',
        workflowVersionId: versionRow?.id ?? null,
        zipPath: zipUp.cloud_storage_path,
        workbookPath: wbUp.cloud_storage_path,
        kmzPath: kmzUp.cloud_storage_path || null,
        summaryPdfPath: pdfUp.cloud_storage_path,
        manifest: pkg.manifest as unknown as Prisma.InputJsonValue,
        generatedById: session.user.id,
      },
    });

    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'closeout.generate',
      entityType: 'CloseoutRevision',
      entityId: created.id,
      metadata: { jobId: id, revision, workflowName, workflowVersion },
      ...requestMeta(request),
    });

    return NextResponse.json(created);
  } catch (err: any) {
    console.error('Generate closeout error:', err);
    return NextResponse.json({ error: 'Failed to generate closeout', detail: String(err?.message ?? err) }, { status: 500 });
  }
}
