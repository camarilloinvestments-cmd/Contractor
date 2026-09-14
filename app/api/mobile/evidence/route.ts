// Increment 10 — Workstream R: Field Evidence Package intake + list.
// Idempotent by localUuid so an offline-queued submission replayed after a
// reconnect returns the existing package instead of creating a duplicate.
// GPS is mandatory-but-flagged: missing/failed coordinates are recorded as
// UNKNOWN geofence status rather than rejecting the worker's evidence.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyMobileSession } from '@/lib/mobile/auth';
import { evaluateGeofence } from '@/lib/mobile/geofence';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const v = await verifyMobileSession(req);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const ctx = v.ctx;
  if (!ctx.workerId) return NextResponse.json({ packages: [] });

  const packages = await prisma.fieldEvidencePackage.findMany({
    where: { workerId: ctx.workerId },
    orderBy: { submittedAt: 'desc' },
    take: 200,
    include: { assets: true, job: { select: { jobNumber: true, jobName: true } } },
  });
  return NextResponse.json({ packages });
}

export async function POST(req: Request) {
  const v = await verifyMobileSession(req);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const ctx = v.ctx;

  const body = await req.json().catch(() => ({} as any));
  const localUuid = body?.localUuid as string | undefined;
  const jobId = body?.jobId as string | undefined;
  if (!localUuid || !jobId) {
    return NextResponse.json({ error: 'localUuid and jobId are required' }, { status: 400 });
  }

  // Idempotent replay.
  const existing = await prisma.fieldEvidencePackage.findUnique({
    where: { localUuid },
    include: { assets: true },
  });
  if (existing) return NextResponse.json({ package: existing, duplicate: true });

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, latitude: true, longitude: true, geofenceRadiusFeet: true },
  });
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const lat = body?.latitude === undefined || body?.latitude === null ? null : Number(body.latitude);
  const lng = body?.longitude === undefined || body?.longitude === null ? null : Number(body.longitude);
  const geo = evaluateGeofence(job, lat, lng);

  let worker = null as null | { companyName: string | null; crewId: string | null };
  if (ctx.workerId) {
    worker = await prisma.worker.findUnique({
      where: { id: ctx.workerId },
      select: { companyName: true, crewId: true },
    });
  }

  const assets = Array.isArray(body?.assets) ? body.assets : [];

  const pkg = await prisma.fieldEvidencePackage.create({
    data: {
      localUuid,
      jobId,
      taskId: (body?.taskId as string | undefined) ?? null,
      workerId: ctx.workerId,
      crewId: worker?.crewId ?? null,
      subcontractorName: worker?.companyName ?? null,
      deviceId: ctx.deviceId,
      latitude: lat,
      longitude: lng,
      gpsAccuracyMeters:
        body?.gpsAccuracyMeters === undefined || body?.gpsAccuracyMeters === null
          ? null
          : Number(body.gpsAccuracyMeters),
      geofenceStatus: geo.status as any,
      geofenceDistanceFeet: geo.distanceFeet,
      productionQuantity:
        body?.productionQuantity === undefined || body?.productionQuantity === null
          ? null
          : Number(body.productionQuantity),
      productionUnit: (body?.productionUnit as string | undefined) ?? null,
      notes: (body?.notes as string | undefined) ?? null,
      signatureStoragePath: (body?.signatureStoragePath as string | undefined) ?? null,
      signatureContentType: (body?.signatureContentType as string | undefined) ?? null,
      signedByName: (body?.signedByName as string | undefined) ?? null,
      capturedAt: body?.capturedAt ? new Date(body.capturedAt) : null,
      assets: {
        create: assets
          .filter((a: any) => a?.localUuid && a?.cloudStoragePath)
          .map((a: any) => ({
            localUuid: String(a.localUuid),
            kind: (a.kind === 'DOCUMENT' ? 'DOCUMENT' : 'PHOTO') as any,
            cloudStoragePath: String(a.cloudStoragePath),
            contentType: a.contentType ?? null,
            fileName: a.fileName ?? null,
            sizeBytes: a.sizeBytes === undefined || a.sizeBytes === null ? null : Number(a.sizeBytes),
            latitude: a.latitude === undefined || a.latitude === null ? null : Number(a.latitude),
            longitude: a.longitude === undefined || a.longitude === null ? null : Number(a.longitude),
            capturedAt: a.capturedAt ? new Date(a.capturedAt) : null,
          })),
      },
    },
    include: { assets: true },
  });

  await writeAudit({
    actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
    action: 'mobile.evidence_submit',
    entityType: 'FieldEvidencePackage',
    entityId: pkg.id,
    metadata: { jobId, geofenceStatus: geo.status, assets: pkg.assets.length, deviceId: ctx.deviceId },
    ...requestMeta(req),
  });

  return NextResponse.json({ package: pkg, duplicate: false });
}
