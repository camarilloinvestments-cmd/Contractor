'use client';
// Offline evidence capture queue (spec §4 / cold-review §4).
//
// Uses IndexedDB (via idb) to persist captured photos + metadata before upload.
// Survives page close, app reopen, and poor-signal conditions.
//
// Retry state machine (cold-review §4):
//   PENDING_UPLOAD        — queued, never attempted (or ready to attempt)
//   UPLOADING             — an attempt is in flight (guarded by an in-memory lock)
//   UPLOADED              — registered server-side (terminal success)
//   RETRYABLE_ERROR       — transient failure; will retry, re-reserving if needed
//   BLOCKED_RETAKE_REQUIRED — permanent failure for this capture (e.g. GPS missing
//                            under a REQUIRED policy); NEVER auto-retried, the tech
//                            must retake the photo.
//
// A reservation (reservationId + presigned uploadUrl) has a TTL. When it is
// expired — or the server reports it 404/409/410 — the stale reservation is
// cleared and a FRESH reservation is obtained on the next attempt rather than
// retrying dead credentials.
//
// IMPORTANT: capturedAt + GPS are field values captured at photo time. Offline
// retry NEVER replaces capturedAt/locationCapturedAt with retry/upload time.

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'os1-evidence-queue';
const DB_VERSION = 1;
const STORE = 'pending';

// Re-reserve if the reservation expires within this margin (clock skew / latency).
const RESERVATION_MARGIN_MS = 60 * 1000;
// An UPLOADING record older than this with no active in-memory lock is stale
// (the tab was closed mid-attempt) and is reconciled back to a retryable state.
const STALE_UPLOADING_MS = 2 * 60 * 1000;

export type QueueStatus =
  | 'PENDING_UPLOAD'
  | 'UPLOADING'
  | 'UPLOADED'
  | 'RETRYABLE_ERROR'
  | 'BLOCKED_RETAKE_REQUIRED';

export interface QueuedEvidence {
  localUuid: string; // primary key
  // Photo blob (removed after successful upload to save space).
  photoBlob: Blob | null;
  fileName: string;
  contentType: string;
  // Field-truth timestamps (§6).
  capturedAt: string; // ISO
  locationCapturedAt: string | null; // ISO
  // GPS.
  latitude: number | null;
  longitude: number | null;
  gpsAccuracyMeters: number | null;
  altitude: number | null;
  heading: number | null;
  speed: number | null;
  // Binding.
  jobId: string;
  taskId: string;
  // Status.
  status: QueueStatus;
  errorMessage: string | null;
  attemptCount: number;
  // Server response (populated after upload).
  evidenceRef: string | null;
  evidenceId: string | null;
  // Reservation (populated after reserve step).
  reservationId: string | null;
  uploadUrl: string | null;
  reservationExpiresAt: string | null; // ISO
  // Timestamps.
  queuedAt: string; // ISO — when queued locally
  lastAttemptAt: string | null;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No IndexedDB in SSR'));
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'localUuid' });
        }
      },
    });
  }
  return dbPromise;
}

// In-memory lock: prevents the online-event handler, a manual retry, and a
// page-mount sweep from processing the SAME record concurrently within a tab.
const processing = new Set<string>();

/** Enqueue a freshly captured photo into IndexedDB. */
export async function enqueueEvidence(item: Omit<QueuedEvidence, 'status' | 'errorMessage' | 'attemptCount' | 'evidenceRef' | 'evidenceId' | 'reservationId' | 'uploadUrl' | 'reservationExpiresAt' | 'queuedAt' | 'lastAttemptAt'>): Promise<QueuedEvidence> {
  const db = await getDb();
  const record: QueuedEvidence = {
    ...item,
    status: 'PENDING_UPLOAD',
    errorMessage: null,
    attemptCount: 0,
    evidenceRef: null,
    evidenceId: null,
    reservationId: null,
    uploadUrl: null,
    reservationExpiresAt: null,
    queuedAt: new Date().toISOString(),
    lastAttemptAt: null,
  };
  await db.put(STORE, record);
  return record;
}

/** List all queued evidence, newest first. */
export async function listQueue(): Promise<QueuedEvidence[]> {
  const db = await getDb();
  const all = await db.getAll(STORE);
  return (all as QueuedEvidence[]).sort((a, b) => (b.queuedAt ?? '').localeCompare(a.queuedAt ?? ''));
}

/** Count items still awaiting a successful upload (excludes blocked + uploaded). */
export async function pendingCount(): Promise<number> {
  const all = await listQueue();
  return all.filter(q => q.status === 'PENDING_UPLOAD' || q.status === 'RETRYABLE_ERROR' || q.status === 'UPLOADING').length;
}

/** Count items permanently blocked awaiting a retake. */
export async function blockedCount(): Promise<number> {
  const all = await listQueue();
  return all.filter(q => q.status === 'BLOCKED_RETAKE_REQUIRED').length;
}

/** Update a queued item's fields. */
export async function updateQueueItem(localUuid: string, patch: Partial<QueuedEvidence>): Promise<void> {
  const db = await getDb();
  const existing = await db.get(STORE, localUuid);
  if (!existing) return;
  await db.put(STORE, { ...existing, ...patch });
}

/** Remove a queued item (after successful upload confirmation). */
export async function removeQueueItem(localUuid: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, localUuid);
}

/** Remove the blob from a completed item to save space while keeping the record. */
export async function clearBlob(localUuid: string): Promise<void> {
  await updateQueueItem(localUuid, { photoBlob: null });
}

/**
 * Reconcile records left in UPLOADING by a tab that closed mid-attempt. Because
 * the in-memory lock does not survive a reload, any UPLOADING record with no
 * active lock and a stale lastAttemptAt is reset to RETRYABLE_ERROR so it can be
 * picked up again (never left stuck).
 */
export async function reconcileStuckUploads(): Promise<void> {
  const items = await listQueue();
  const now = Date.now();
  for (const item of items) {
    if (item.status !== 'UPLOADING') continue;
    if (processing.has(item.localUuid)) continue; // genuinely in flight in this tab
    const last = item.lastAttemptAt ? Date.parse(item.lastAttemptAt) : 0;
    if (now - last > STALE_UPLOADING_MS) {
      await updateQueueItem(item.localUuid, { status: 'RETRYABLE_ERROR', errorMessage: 'Interrupted — will retry' });
    }
  }
}

type FailKind = 'retryable' | 'blocked';

function classifyRegisterFailure(status: number, data: any): FailKind {
  const code = data?.code as string | undefined;
  // Permanent for THIS capture — a retake (or new capture) is required.
  if (status === 422 && code === 'GPS_POLICY') return 'blocked';
  if (status === 413 || code === 'TOO_LARGE') return 'blocked';
  if (status === 415 || code === 'UNSUPPORTED_TYPE') return 'blocked';
  if (status === 400) {
    // "not found in storage" means the upload never landed — retry (re-upload).
    const msg = String(data?.error || '').toLowerCase();
    if (msg.includes('not found in storage') || msg.includes('missing')) return 'retryable';
    return 'blocked'; // undecodable / invalid image — retake required
  }
  // Reservation problems, auth-signature/URL expiry, and server faults: retry.
  return 'retryable';
}

async function obtainReservation(item: QueuedEvidence): Promise<{ reservationId: string; uploadUrl: string; reservationExpiresAt: string | null }> {
  const reserveRes = await fetch('/api/portal/photo-evidence/reserve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taskId: item.taskId,
      jobId: item.jobId,
      contentType: item.contentType || 'image/jpeg',
      fileName: item.fileName,
    }),
  });
  if (!reserveRes.ok) {
    const err = await reserveRes.json().catch(() => ({}));
    throw new Error(err?.error || `Reserve failed (${reserveRes.status})`);
  }
  const data = await reserveRes.json();
  return { reservationId: data.reservationId, uploadUrl: data.uploadUrl, reservationExpiresAt: data.expiresAt ?? null };
}

function reservationUsable(item: QueuedEvidence): boolean {
  if (!item.reservationId || !item.uploadUrl) return false;
  if (!item.reservationExpiresAt) return true; // legacy record; server re-validates
  return Date.parse(item.reservationExpiresAt) - Date.now() > RESERVATION_MARGIN_MS;
}

/**
 * Process one queued item: (re)reserve → upload → register.
 * Returns true only on confirmed server registration.
 * NEVER replaces capturedAt/locationCapturedAt with the current time.
 */
export async function processQueueItem(input: QueuedEvidence): Promise<boolean> {
  // Concurrency guard 1: in-memory lock (same tab, multiple triggers).
  if (processing.has(input.localUuid)) return false;
  processing.add(input.localUuid);
  try {
    // Concurrency guard 2: re-read the authoritative record and refuse to act on
    // one already terminal or actively uploading elsewhere.
    const db = await getDb();
    const item = (await db.get(STORE, input.localUuid)) as QueuedEvidence | undefined;
    if (!item) return false;
    if (item.status === 'UPLOADED') return true;
    if (item.status === 'BLOCKED_RETAKE_REQUIRED') return false;
    if (item.status === 'UPLOADING') {
      // Another attempt in this tab holds it (lock was set before status flip),
      // or it is stale from a previous tab. Stale ones are handled by
      // reconcileStuckUploads(); here we simply do not double-process.
      const last = item.lastAttemptAt ? Date.parse(item.lastAttemptAt) : 0;
      if (Date.now() - last <= STALE_UPLOADING_MS) return false;
    }
    if (!item.photoBlob) {
      // No bytes to upload and not yet registered — a retake is required.
      await updateQueueItem(item.localUuid, { status: 'BLOCKED_RETAKE_REQUIRED', errorMessage: 'Photo data missing — retake required' });
      return false;
    }

    const now = new Date().toISOString();
    await updateQueueItem(item.localUuid, { status: 'UPLOADING', lastAttemptAt: now, attemptCount: (item.attemptCount ?? 0) + 1 });

    // 1. Ensure a usable reservation. Expired/absent → obtain a fresh one
    //    (never retry a stale presigned URL / reservation).
    let reservationId = item.reservationId;
    let uploadUrl = item.uploadUrl;
    if (!reservationUsable(item)) {
      if (item.reservationId || item.uploadUrl) {
        await updateQueueItem(item.localUuid, { reservationId: null, uploadUrl: null, reservationExpiresAt: null });
      }
      try {
        const fresh = await obtainReservation(item);
        reservationId = fresh.reservationId;
        uploadUrl = fresh.uploadUrl;
        await updateQueueItem(item.localUuid, { reservationId, uploadUrl, reservationExpiresAt: fresh.reservationExpiresAt });
      } catch (err: any) {
        await updateQueueItem(item.localUuid, { status: 'RETRYABLE_ERROR', errorMessage: String(err?.message || err).slice(0, 300) });
        return false;
      }
    }

    // 2. Upload original to S3. A 403 typically means the presigned URL expired —
    //    clear the reservation so the next attempt re-reserves.
    try {
      const putRes = await fetch(uploadUrl!, {
        method: 'PUT',
        headers: { 'Content-Type': item.contentType || 'image/jpeg' },
        body: item.photoBlob,
      });
      if (!putRes.ok) {
        if (putRes.status === 403 || putRes.status === 400) {
          await updateQueueItem(item.localUuid, { reservationId: null, uploadUrl: null, reservationExpiresAt: null });
        }
        throw new Error(`S3 upload failed (${putRes.status})`);
      }
    } catch (err: any) {
      await updateQueueItem(item.localUuid, { status: 'RETRYABLE_ERROR', errorMessage: String(err?.message || err).slice(0, 300) });
      return false;
    }

    // 3. Register evidence (idempotent by localUuid).
    let regRes: Response;
    try {
      regRes = await fetch('/api/portal/photo-evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          localUuid: item.localUuid,
          reservationId,
          taskId: item.taskId,
          jobId: item.jobId,
          originalFileName: item.fileName,
          latitude: item.latitude,
          longitude: item.longitude,
          gpsAccuracyMeters: item.gpsAccuracyMeters,
          altitude: item.altitude,
          heading: item.heading,
          speed: item.speed,
          locationCapturedAt: item.locationCapturedAt,
          capturedAt: item.capturedAt, // field truth, NEVER replaced
        }),
      });
    } catch (err: any) {
      // Network dropped after upload — retry is idempotent by localUuid.
      await updateQueueItem(item.localUuid, { status: 'RETRYABLE_ERROR', errorMessage: String(err?.message || err).slice(0, 300) });
      return false;
    }

    const regData = await regRes.json().catch(() => ({}));

    if (regRes.ok) {
      // Success (including idempotent duplicate:true).
      await updateQueueItem(item.localUuid, {
        status: 'UPLOADED',
        evidenceRef: regData?.evidenceRef ?? null,
        evidenceId: regData?.id ?? null,
        errorMessage: null,
        photoBlob: null, // free space
      });
      return true;
    }

    // Failure — classify.
    const kind = classifyRegisterFailure(regRes.status, regData);
    if (kind === 'blocked') {
      await updateQueueItem(item.localUuid, {
        status: 'BLOCKED_RETAKE_REQUIRED',
        errorMessage: regData?.error || 'This photo cannot be accepted — retake required',
      });
      return false;
    }

    // Retryable: for reservation-state errors, drop the stale reservation so the
    // next attempt obtains a fresh one.
    if (regRes.status === 404 || regRes.status === 409 || regRes.status === 410) {
      await updateQueueItem(item.localUuid, { reservationId: null, uploadUrl: null, reservationExpiresAt: null });
    }
    await updateQueueItem(item.localUuid, {
      status: 'RETRYABLE_ERROR',
      errorMessage: regData?.error || `Register failed (${regRes.status})`,
    });
    return false;
  } finally {
    processing.delete(input.localUuid);
  }
}

/**
 * Process all items eligible for an attempt (PENDING_UPLOAD or RETRYABLE_ERROR).
 * BLOCKED_RETAKE_REQUIRED items are never auto-retried. Returns the count of
 * items successfully registered this pass.
 */
export async function processQueue(): Promise<number> {
  await reconcileStuckUploads();
  const items = await listQueue();
  const eligible = items.filter(q => q.status === 'PENDING_UPLOAD' || q.status === 'RETRYABLE_ERROR');
  let ok = 0;
  for (const item of eligible) {
    const success = await processQueueItem(item);
    if (success) ok++;
  }
  return ok;
}
