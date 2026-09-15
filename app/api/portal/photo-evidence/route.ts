export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getObjectBytes, getFileUrl, headObject } from '@/lib/s3';
import { writeAudit, requestMeta } from '@/lib/audit';
import { allocateNumber, NumberAllocationError } from '@/lib/documents/numbering';
import { getWatermarkSettings, sha256Hex, generateAndPersistWatermark } from '@/lib/evidence/photo-evidence';
import { evaluateGpsPolicy, classifyAccuracy, type GpsPolicy } from '@/lib/evidence/gps-policy';
import { reverseGeocode } from '@/lib/evidence/geocode';
import { Prisma } from '@prisma/client';
import { MAX_PIXEL_AREA, MAX_UPLOAD_BYTES, ALLOWED_EVIDENCE_MIME } from '@/lib/evidence/upload-constants';
import sharp from 'sharp';

// Internal control-flow markers for the atomic consumption transaction (§2).
class ReservationClaimError extends Error {}
class DuplicateLocalUuidError extends Error {}

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

  // §2: Resolve + validate the reservation as a pre-flight. The authoritative,
  // single-use claim happens atomically inside the transaction further below.
  const reservation = await prisma.evidenceUploadReservation.findUnique({ where: { id: reservationId } });
  if (!reservation) return NextResponse.json({ error: 'Upload reservation not found' }, { status: 404 });
  // Verify reservation actor/task/job binding.
  if (reservation.userId !== session.user.id || reservation.workerId !== workerId) {
    return NextResponse.json({ error: 'Reservation does not belong to you' }, { status: 403 });
  }
  if (reservation.taskId !== taskId || reservation.jobId !== jobId) {
    return NextResponse.json({ error: 'Reservation task/job mismatch' }, { status: 403 });
  }
  // If already consumed, an evidence row was (or is being) created for it. Return
  // that record idempotently rather than a hard error (§2 lost-response retry).
  if (reservation.consumed) {
    if (reservation.evidenceId) {
      const prior = await prisma.fieldPhotoEvidence.findUnique({ where: { id: reservation.evidenceId } });
      if (prior) return NextResponse.json({ id: prior.id, evidenceRef: prior.evidenceRef, status: prior.status, duplicate: true });
    }
    const priorByUuid = await prisma.fieldPhotoEvidence.findUnique({ where: { localUuid } });
    if (priorByUuid) return NextResponse.json({ id: priorByUuid.id, evidenceRef: priorByUuid.evidenceRef, status: priorByUuid.status, duplicate: true });
    return NextResponse.json({ error: 'Upload reservation already used', code: 'RESERVATION_CONSUMED' }, { status: 409 });
  }
  if (reservation.expiresAt < new Date()) return NextResponse.json({ error: 'Upload reservation expired', code: 'RESERVATION_EXPIRED' }, { status: 410 });
  const originalStoragePath = reservation.storagePath;
  const originalContentType = reservation.contentType;
  const maxSizeBytes = reservation.maxSizeBytes ?? MAX_UPLOAD_BYTES;

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

  // §3: HEAD the object FIRST — confirm it exists, is within the size cap, and is
  // an allowed content type BEFORE ever pulling it into memory. This rejects an
  // oversized or wrong-type object without downloading it.
  const head = await headObject(originalStoragePath);
  if (!head.exists) return NextResponse.json({ error: 'Uploaded original not found in storage' }, { status: 400 });
  if (head.contentLength != null && head.contentLength > maxSizeBytes) {
    return NextResponse.json({ error: `Photo exceeds ${Math.floor(maxSizeBytes / 1024 / 1024)} MB limit`, code: 'TOO_LARGE' }, { status: 413 });
  }
  const headType = (head.contentType || originalContentType || '').toLowerCase();
  if (headType && !ALLOWED_EVIDENCE_MIME.has(headType)) {
    return NextResponse.json({ error: `Unsupported image type: ${headType}`, code: 'UNSUPPORTED_TYPE' }, { status: 415 });
  }

  // Now safe to download (size-guarded — returns null if the object is over cap).
  const originalBytes = await getObjectBytes(originalStoragePath, maxSizeBytes);
  if (!originalBytes) return NextResponse.json({ error: 'Uploaded original missing or exceeds size limit', code: 'TOO_LARGE' }, { status: 413 });
  const originalSizeBytes = originalBytes.length;

  // §2: Validate image decodes and enforce pixel limits.
  try {
    const imeta = await sharp(originalBytes, { failOn: 'none' }).metadata();
    if (!imeta.width || !imeta.height) throw new Error('Not a valid image');
    if (imeta.width * imeta.height > MAX_PIXEL_AREA) {
      return NextResponse.json({ error: `Image dimensions exceed ${MAX_PIXEL_AREA / 1_000_000} megapixel limit` }, { status: 413 });
    }
  } catch {
    return NextResponse.json({ error: 'File is not a valid/decodable image' }, { status: 400 });
  }

  const originalSha256 = sha256Hex(originalBytes);
  const originalFileName = body?.originalFileName || 'photo.jpg';

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

  // §2: Atomic reservation consumption + evidence creation.
  // The reservation is claimed with a conditional updateMany (consumed:false AND
  // not expired) and the evidence row is created in the SAME transaction, so:
  //  - two concurrent requests can never both claim it (updateMany row-locks it,
  //    the loser sees count===0),
  //  - a create failure rolls the claim back (the reservation stays usable),
  //  - consumedAt + evidenceId are recorded on success for lost-response retries.
  // A P2002 on evidenceRef aborts and RETRIES the whole transaction (a Postgres
  // error taints the tx, so retry must be at the transaction boundary).
  let created: any = null;
  let claimFailed = false;
  let duplicate = false;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5 && !created && !claimFailed && !duplicate; attempt++) {
    try {
      created = await prisma.$transaction(async (tx) => {
        const claim = await tx.evidenceUploadReservation.updateMany({
          where: { id: reservationId, userId: session.user.id, workerId, taskId, jobId, consumed: false, expiresAt: { gt: new Date() } },
          data: { consumed: true, consumedAt: nowTs },
        });
        if (claim.count !== 1) throw new ReservationClaimError();

        const evidenceRef = await allocateNumber('PHOTO_EVIDENCE', tx);
        let rec: any;
        try {
          rec = await tx.fieldPhotoEvidence.create({
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
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            const target = (err.meta?.target as string[] | string | undefined) ?? '';
            const targetStr = Array.isArray(target) ? target.join(',') : String(target);
            if (targetStr.includes('localUuid')) throw new DuplicateLocalUuidError();
          }
          throw err; // evidenceRef collision or other error -> abort + retry whole tx.
        }

        // Record which evidence consumed the reservation (lost-response idempotency).
        await tx.evidenceUploadReservation.update({ where: { id: reservationId }, data: { evidenceId: rec.id } });
        return rec;
      });
    } catch (err) {
      if (err instanceof ReservationClaimError) { claimFailed = true; break; }
      if (err instanceof DuplicateLocalUuidError) { duplicate = true; break; }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') { lastErr = err; continue; }
      throw err;
    }
  }

  if (duplicate || claimFailed) {
    // Either the same capture already landed, or we lost the claim race. Both are
    // resolved by returning the existing evidence row for this localUuid.
    const dup = await prisma.fieldPhotoEvidence.findUnique({ where: { localUuid } });
    if (dup) return NextResponse.json({ id: dup.id, evidenceRef: dup.evidenceRef, status: dup.status, duplicate: true });
    return NextResponse.json(
      { error: duplicate ? 'Duplicate submission' : 'Upload reservation unavailable', code: duplicate ? 'DUPLICATE' : 'RESERVATION_UNAVAILABLE' },
      { status: 409 }
    );
  }
  if (!created) {
    throw (lastErr instanceof Error ? lastErr : new NumberAllocationError('Failed to allocate a unique PHOTO_EVIDENCE number after 5 attempts'));
  }

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
