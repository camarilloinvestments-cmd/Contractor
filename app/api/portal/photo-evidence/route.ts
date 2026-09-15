export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getObjectBytes, getFileUrl } from '@/lib/s3';
import { writeAudit, requestMeta } from '@/lib/audit';
import { createWithNumber } from '@/lib/documents/numbering';
import { getWatermarkSettings, sha256Hex, generateAndPersistWatermark } from '@/lib/evidence/photo-evidence';
import { evaluateGpsPolicy, classifyAccuracy, type GpsPolicy } from '@/lib/evidence/gps-policy';

// GET: list the current technician's field photo evidence (optionally by task/job).
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('taskId');
  const jobId = searchParams.get('jobId');

  const where: any = { capturedByUserId: session.user.id };
  if (taskId) where.taskId = taskId;
  if (jobId) where.jobId = jobId;

  const rows = await prisma.fieldPhotoEvidence.findMany({
    where,
    orderBy: { capturedAt: 'desc' },
    take: 100,
  });

  const items = await Promise.all(
    rows.map(async (r) => {
      let watermarkedUrl: string | null = null;
      if (r.watermarkedStoragePath) {
        try { watermarkedUrl = await getFileUrl(r.watermarkedStoragePath, r.watermarkedContentType ?? 'image/jpeg', false); } catch { /* skip */ }
      }
      return {
        id: r.id,
        evidenceRef: r.evidenceRef,
        status: r.status,
        capturedAt: r.capturedAt,
        latitude: r.latitude,
        longitude: r.longitude,
        gpsAccuracyMeters: r.gpsAccuracyMeters,
        accuracyClass: r.accuracyClass,
        watermarkedUrl,
      };
    })
  );
  return NextResponse.json({ items });
}

// POST: register a captured photo (original already uploaded to storage).
// Idempotent by localUuid — a retry returns the existing record (§11/§22).
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const {
    localUuid, jobId, taskId,
    originalStoragePath, originalFileName, originalContentType,
    latitude, longitude, gpsAccuracyMeters, altitude, heading, speed,
    locationCapturedAt, address, capturedAt,
  } = body ?? {};

  if (!localUuid || typeof localUuid !== 'string') return NextResponse.json({ error: 'Missing localUuid' }, { status: 400 });
  if (!jobId || typeof jobId !== 'string') return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
  if (!originalStoragePath || typeof originalStoragePath !== 'string') return NextResponse.json({ error: 'Missing originalStoragePath' }, { status: 400 });

  // Idempotent retry: return the existing record without creating a duplicate.
  const existing = await prisma.fieldPhotoEvidence.findUnique({ where: { localUuid } });
  if (existing) {
    return NextResponse.json({ id: existing.id, evidenceRef: existing.evidenceRef, status: existing.status, duplicate: true });
  }

  // Validate the referenced Job (Work Order) exists and resolve snapshot context.
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, projectId: true, primeContractorId: true },
  });
  if (!job) return NextResponse.json({ error: 'Work order not found' }, { status: 404 });

  // Enforce GPS policy server-side (§8 validate submitted metadata).
  const settings = await getWatermarkSettings();
  const decision = evaluateGpsPolicy(
    { latitude, longitude, accuracyMeters: gpsAccuracyMeters },
    settings.gpsPolicy as GpsPolicy,
    settings.maxAccuracyMeters
  );
  if (decision.blocked) {
    return NextResponse.json({ error: decision.message ?? 'GPS policy not satisfied', code: 'GPS_POLICY' }, { status: 422 });
  }

  // Authoritative hash + size from the actual stored bytes (never trust client).
  const originalBytes = await getObjectBytes(originalStoragePath);
  if (!originalBytes) return NextResponse.json({ error: 'Uploaded original not found in storage' }, { status: 400 });
  const originalSha256 = sha256Hex(originalBytes);
  const originalSizeBytes = originalBytes.length;

  // Technician display name.
  let technicianName: string | null = session.user.name ?? session.user.email ?? null;
  if (session.user.workerId) {
    const w = await prisma.worker.findUnique({ where: { id: session.user.workerId }, select: { name: true } });
    if (w?.name) technicianName = w.name;
  }

  const capturedAtDate = capturedAt ? new Date(capturedAt) : new Date();
  const locCapturedDate = locationCapturedAt ? new Date(locationCapturedAt) : null;
  const accuracyClass = classifyAccuracy(gpsAccuracyMeters);

  // Create the record with a unique EV-000000 reference (retry-safe).
  const created = await createWithNumber('PHOTO_EVIDENCE', (evidenceRef) =>
    prisma.fieldPhotoEvidence.create({
      data: {
        evidenceRef,
        localUuid,
        jobId: job.id,
        taskId: taskId || null,
        capturedByUserId: session.user.id,
        projectId: job.projectId,
        primeContractorId: job.primeContractorId,
        deviceId: null,
        technicianName,
        originalStoragePath,
        originalSha256,
        originalFileName: originalFileName || 'photo.jpg',
        originalContentType: originalContentType || 'image/jpeg',
        originalSizeBytes,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        gpsAccuracyMeters: gpsAccuracyMeters ?? null,
        altitude: altitude ?? null,
        heading: heading ?? null,
        speed: speed ?? null,
        locationCapturedAt: locCapturedDate,
        address: address || null,
        accuracyClass,
        gpsPolicyAtCapture: settings.gpsPolicy,
        capturedAt: capturedAtDate,
        status: 'UPLOADED',
      },
    })
  );

  const meta = requestMeta(request);
  const actor = { id: session.user.id, email: session.user.email ?? '', role: session.user.role ?? '' };
  await writeAudit({ actor, action: 'evidence.photo_captured', entityType: 'FieldPhotoEvidence', entityId: created.id, metadata: { evidenceRef: created.evidenceRef, jobId, taskId: taskId || null, originalSha256 }, ...meta });
  if (latitude != null && longitude != null) {
    await writeAudit({ actor, action: 'evidence.location_captured', entityType: 'FieldPhotoEvidence', entityId: created.id, metadata: { latitude, longitude, gpsAccuracyMeters: gpsAccuracyMeters ?? null, accuracyClass }, ...meta });
  }

  // Generate the watermarked derivative server-side. Failure never loses the
  // original — the record is marked FAILED and can be regenerated.
  let watermarkStatus: 'WATERMARKED' | 'FAILED' = 'WATERMARKED';
  try {
    await generateAndPersistWatermark(created.id);
    await writeAudit({ actor, action: 'evidence.watermark_generated', entityType: 'FieldPhotoEvidence', entityId: created.id, metadata: { evidenceRef: created.evidenceRef }, ...meta });
  } catch {
    watermarkStatus = 'FAILED';
  }

  return NextResponse.json({
    id: created.id,
    evidenceRef: created.evidenceRef,
    status: watermarkStatus,
    warn: decision.warn,
    message: decision.message,
  });
}
