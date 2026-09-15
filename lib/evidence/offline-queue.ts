'use client';
// Offline evidence capture queue (spec §4 / cold-review §4).
//
// Uses IndexedDB (via idb) to persist captured photos + metadata before upload.
// Survives page close, app reopen, and poor-signal conditions.
//
// Queue lifecycle:
//   1. Camera capture → immediately persist to IndexedDB (PENDING_UPLOAD)
//   2. When online: reserve → upload original → register → UPLOADED
//   3. On success: remove blob from IDB (keep lightweight record for UI)
//   4. On failure: mark FAILED, retry idempotently via localUuid
//
// IMPORTANT: capturedAt + GPS are field values captured at photo time.
// Offline retry NEVER replaces capturedAt with retry/upload time.

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'os1-evidence-queue';
const DB_VERSION = 1;
const STORE = 'pending';

export type QueueStatus = 'PENDING_UPLOAD' | 'UPLOADING' | 'UPLOADED' | 'FAILED';

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
  // Server response (populated after upload).
  evidenceRef: string | null;
  evidenceId: string | null;
  // Reservation (populated after reserve step).
  reservationId: string | null;
  uploadUrl: string | null;
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

/** Enqueue a freshly captured photo into IndexedDB. */
export async function enqueueEvidence(item: Omit<QueuedEvidence, 'status' | 'errorMessage' | 'evidenceRef' | 'evidenceId' | 'reservationId' | 'uploadUrl' | 'queuedAt' | 'lastAttemptAt'>): Promise<QueuedEvidence> {
  const db = await getDb();
  const record: QueuedEvidence = {
    ...item,
    status: 'PENDING_UPLOAD',
    errorMessage: null,
    evidenceRef: null,
    evidenceId: null,
    reservationId: null,
    uploadUrl: null,
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

/** Count items still pending or failed. */
export async function pendingCount(): Promise<number> {
  const all = await listQueue();
  return all.filter(q => q.status === 'PENDING_UPLOAD' || q.status === 'FAILED').length;
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
 * Process one queued item: reserve → upload → register.
 * Returns true on success, false on failure (item stays in queue for retry).
 * NEVER replaces capturedAt/locationCapturedAt with the current time.
 */
export async function processQueueItem(item: QueuedEvidence): Promise<boolean> {
  if (!item.photoBlob) {
    await updateQueueItem(item.localUuid, { status: 'FAILED', errorMessage: 'Photo blob missing from queue' });
    return false;
  }
  const now = new Date().toISOString();
  await updateQueueItem(item.localUuid, { status: 'UPLOADING', lastAttemptAt: now });

  try {
    // 1. Reserve upload slot.
    let reservationId = item.reservationId;
    let uploadUrl = item.uploadUrl;
    if (!reservationId || !uploadUrl) {
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
      const reserveData = await reserveRes.json();
      reservationId = reserveData.reservationId;
      uploadUrl = reserveData.uploadUrl;
      await updateQueueItem(item.localUuid, { reservationId, uploadUrl });
    }

    // 2. Upload original to S3.
    const putRes = await fetch(uploadUrl!, {
      method: 'PUT',
      headers: { 'Content-Type': item.contentType || 'image/jpeg' },
      body: item.photoBlob,
    });
    if (!putRes.ok) throw new Error(`S3 upload failed (${putRes.status})`);

    // 3. Register evidence (idempotent by localUuid).
    const regRes = await fetch('/api/portal/photo-evidence', {
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
    const regData = await regRes.json().catch(() => ({}));
    if (!regRes.ok && regRes.status !== 422) throw new Error(regData?.error || `Register failed (${regRes.status})`);
    if (regRes.status === 422 && regData?.code === 'GPS_POLICY') {
      // GPS policy block — mark failed, do not retry automatically.
      await updateQueueItem(item.localUuid, {
        status: 'FAILED',
        errorMessage: regData?.error || 'GPS location required',
      });
      return false;
    }

    // Success.
    await updateQueueItem(item.localUuid, {
      status: 'UPLOADED',
      evidenceRef: regData?.evidenceRef ?? null,
      evidenceId: regData?.id ?? null,
      errorMessage: null,
      photoBlob: null, // free space
    });
    return true;
  } catch (err: any) {
    await updateQueueItem(item.localUuid, {
      status: 'FAILED',
      errorMessage: String(err?.message || err).slice(0, 300),
    });
    return false;
  }
}

/** Process all pending/failed items. Returns count of successfully processed. */
export async function processQueue(): Promise<number> {
  const items = await listQueue();
  const pending = items.filter(q => q.status === 'PENDING_UPLOAD' || q.status === 'FAILED');
  let ok = 0;
  for (const item of pending) {
    const success = await processQueueItem(item);
    if (success) ok++;
  }
  return ok;
}
