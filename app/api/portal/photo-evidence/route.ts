export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getObjectBytes, getFileUrl } from '@/lib/s3';
import { writeAudit, requestMeta } from '@/lib/audit';
import { createWithNumber } from '@/lib/documents/numbering';
import { getWatermarkSettings, sha256Hex, generateAndPersistWatermark } from '@/lib/evidence/photo-evidence';
import { evaluateGpsPolicy, classifyAccuracy, type GpsPolicy } from '@/lib/evidence/gps-policy';
import { reverseGeocode } from '@/lib/evidence/geocode';
import sharp from 'sharp';

// Evidence image safety limits.
const MAX_PIXEL_AREA = 100_000_000; // ~100 MP (10000x10000)
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

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
    rows.map(async (r: any) => {
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

// POST: register a captured photo via a server-issued upload reservation.
// Idempotent by localUuid — a retry returns the existing record (§11/§22).
// §1: Validates task assignment + work order binding server-side.
// §2: Resolves storage path from reservation (never trusts client path).
// §3: Reverse-geocodes address server-side.
// §6: Distinguishes capturedAt / locationCapturedAt / receivedAt / uploadedAt.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // §1: field-tech must have a workerId.
  const workerId = session.user.workerId;
  if (!workerId) {
    return NextResponse.json({ error: 'No worker profile associated with your account' }, { status: 403 });
  }

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const {
    localUuid, reservationId, taskId, jobId,
    latitude, longitude, gpsAccuracyMeters, altitude, heading, speed,
    locationCapturedAt, capturedAt,
    // Legacy compat: if client sends originalStoragePath without reservation, reject.
    originalStoragePath: _legacyPath,
  } = body ?? {};

  if (!localUuid || typeof localUuid !== 'string') return NextResponse.json({ error: 'Missing localUuid' }, { status: 400 });
  if (!taskId || typeof taskId !== 'string') return NextResponse.json({ error: 'Missing taskId' }, { status: 400 });
  if (!jobId || typeof jobId !== 'string') return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });

  // §2: reservationId is required (no longer accept raw storage path).
  if (!reservationId || typeof reservationId !== 'string') {
    return NextResponse.json({ error: 'Missing reservationId — use /api/portal/photo-evidence/reserve first' }, { status: 400 });
  }

  // Idempotent retry: return the existing record without creating a duplicate.
  const existing = await prisma.fieldPhotoEvidence.findUnique({ where: { localUuid } });
  if (existing) {
    return NextResponse.json({ id: existing.id, evidenceRef: existing.evidenceRef, status: existing.status, duplicate: true });
  }

  // §1: Verify task exists, is assigned to this worker, and belongs to submitted job.
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, jobId: true, workerId: true },
  });
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  if (task.workerId !== workerId) {
    return NextResponse.json({ error: 'You are not assigned to this task' }, { status: 403 });
  }
  if (task.jobId !== jobId) {
    return NextResponse.json({ error: 'Task does not belong to the specified work order' }, { status: 403 });
  }

  // Validate the referenced Job (Work Order) exists and resolve snapshot context.
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, projectId: true, primeContractorId: true },
  });
  if (!job) return NextResponse.json({ error: 'Work order not found' }, { status: 404 });

  // §2: Resolve storage path from the reservation (never trust client path).
  const reservation = await prisma.evidenceUploadReservation.findUnique({ where: { id: reservationId } });
  if (!reservation) return NextResponse.json({ error: 'Upload reservation not found' }, { status: 404 });
  if (reservation.consumed) return NextResponse.json({ error: 'Upload reservation already used' }, { status: 409 });
  if (reservation.expiresAt < new Date()) return NextResponse.json({ error: 'Upload reservation expired' }, { status: 410 });
  // Verify reservation actor/task/job binding.
  if (reservation.userId !== session.user.id || reservation.workerId !== workerId) {
    return NextResponse.json({ error: 'Reservation does not belong to you' }, { status: 403 });
  }
  if (reservation.taskId !== taskId || reservation.jobId !== jobId) {
    return NextResponse.json({ error: 'Reservation task/job mismatch' }, { status: 403 });
  }
  const originalStoragePath = reservation.storagePath;
  const originalContentType = reservation.contentType;

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
  const originalSizeBytes = originalBytes.length;

  // §2: Enforce size limit.
  if (originalSizeBytes > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `Photo exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit` }, { status: 413 });
  }

  // §2: Validate image decodes and enforce pixel limits.
  try {
    const meta = await sharp(originalBytes, { failOn: 'none' }).metadata();
    if (!meta.width || !meta.height) throw new Error('Not a valid image');
    if (meta.width * meta.height > MAX_PIXEL_AREA) {
      return NextResponse.json({ error: `Image dimensions exceed ${MAX_PIXEL_AREA / 1_000_000} megapixel limit` }, { status: 413 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: 'File is not a valid/decodable image' }, { status: 400 });
  }

  const originalSha256 = sha256Hex(originalBytes);
  const originalFileName = body?.originalFileName || 'photo.jpg';

  // Mark reservation consumed (single-use).
  await prisma.evidenceUploadReservation.update({
    where: { id: reservationId },
    data: { consumed: true },
  });

  // Technician display name.
  let technicianName: string | null = session.user.name ?? session.user.email ?? null;
  const w = await prisma.worker.findUnique({ where: { id: workerId }, select: { name: true } });
  if (w?.name) technicianName = w.name;

  const capturedAtDate = capturedAt ? new Date(capturedAt) : new Date();
  const locCapturedDate = locationCapturedAt ? new Date(locationCapturedAt) : null;
  const accuracyClass = classifyAccuracy(gpsAccuracyMeters);
  const nowTs = new Date();

  // §3: Server-side reverse geocode (failure never blocks evidence).
  let resolvedAddress: string | null = null;
  let addressLookupAt: Date | null = null;
  let addressProvider: string | null = null;
  if (latitude != null && longitude != null && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    try {
      const geo = await reverseGeocode(latitude, longitude, settings.geocodeProvider ?? 'nominatim');
      if (geo) {
        resolvedAddress = geo.address;
        addressLookupAt = geo.lookedUpAt;
        addressProvider = geo.provider;
      }
    } catch { /* never block evidence on geocode failure */ }
  }

  // Create the record with a unique EV-000000 reference (retry-safe).
  const created = await createWithNumber('PHOTO_EVIDENCE', (evidenceRef) =>
    prisma.fieldPhotoEvidence.create({
      data: {
        evidenceRef,
        localUuid,
        jobId: job.id,
        taskId: task.id,
        capturedByUserId: session.user.id,
        projectId: job.projectId,
        primeContractorId: job.primeContractorId,
        deviceId: null,
        technicianName,
        originalStoragePath,
        originalSha256,
        originalFileName,
        originalContentType,
        originalSizeBytes,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        gpsAccuracyMeters: gpsAccuracyMeters ?? null,
        altitude: altitude ?? null,
        heading: heading ?? null,
        speed: speed ?? null,
        locationCapturedAt: locCapturedDate,
        address: resolvedAddress,
        addressLookupAt,
        addressProvider,
        accuracyClass,
        gpsPolicyAtCapture: settings.gpsPolicy,
        capturedAt: capturedAtDate,
        uploadedAt: nowTs, // §6: server confirms upload time.
        status: 'UPLOADED',
      },
    })
  );

  const rec = created as any;
  const meta = requestMeta(request);
  const actor = { id: session.user.id, email: session.user.email ?? '', role: session.user.role ?? '' };
  await writeAudit({ actor, action: 'evidence.photo_captured', entityType: 'FieldPhotoEvidence', entityId: rec.id, metadata: { evidenceRef: rec.evidenceRef, jobId, taskId, reservationId, originalSha256 }, ...meta });
  if (latitude != null && longitude != null) {
    await writeAudit({ actor, action: 'evidence.location_captured', entityType: 'FieldPhotoEvidence', entityId: rec.id, metadata: { latitude, longitude, gpsAccuracyMeters: gpsAccuracyMeters ?? null, accuracyClass }, ...meta });
  }

  // Generate the watermarked derivative server-side. Failure never loses the
  // original — the record is marked FAILED and can be regenerated.
  let watermarkStatus: 'WATERMARKED' | 'FAILED' = 'WATERMARKED';
  try {
    await generateAndPersistWatermark(rec.id);
    await writeAudit({ actor, action: 'evidence.watermark_generated', entityType: 'FieldPhotoEvidence', entityId: rec.id, metadata: { evidenceRef: rec.evidenceRef }, ...meta });
  } catch {
    watermarkStatus = 'FAILED';
  }

  return NextResponse.json({
    id: rec.id,
    evidenceRef: rec.evidenceRef,
    status: watermarkStatus,
    warn: decision.warn,
    message: decision.message,
  });
}
