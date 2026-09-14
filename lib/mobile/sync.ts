// Increment 10 — Workstream Q: offline sync ingestion (server side).
// Each queued client record carries a per-device local UUID + a stable
// idempotency key. The server records the outcome in MobileSyncEvent so retries
// are de-duplicated and conflicts are surfaced. This is the durable server
// acknowledgment the client reconciles its local queue against.
import { prisma } from '@/lib/prisma';

export type SyncEntityType =
  | 'GPS'
  | 'TASK_UPDATE'
  | 'PRODUCTION'
  | 'NOTE'
  | 'EVIDENCE'
  | 'PHOTO'
  | 'DOCUMENT'
  | 'SIGNATURE';

export type SyncResult = 'ACCEPTED' | 'DUPLICATE' | 'CONFLICT' | 'REJECTED';

export interface QueuedRecord {
  localUuid: string;
  idempotencyKey: string;
  entityType: SyncEntityType;
  deviceTimestamp?: string | null;
  createdTimestamp?: string | null;
  retryCount?: number | null;
  // Free-form payload the specific handler interprets (task id, quantity, etc.).
  payload?: Record<string, any> | null;
}

export interface SyncAck {
  localUuid: string;
  idempotencyKey: string;
  result: SyncResult;
  serverEntityId?: string | null;
  conflictStatus?: string | null;
  error?: string | null;
}

// Records a single queued record's outcome idempotently. If the idempotency key
// (or device+localUuid) was already processed, returns the prior result as a
// DUPLICATE ack instead of creating a second row.
export async function recordSyncOutcome(params: {
  deviceId: string | null;
  workerId: string | null;
  record: QueuedRecord;
  result: SyncResult;
  serverEntityId?: string | null;
  conflictStatus?: string | null;
  error?: string | null;
}): Promise<SyncAck> {
  const { deviceId, workerId, record } = params;

  const prior = await prisma.mobileSyncEvent.findUnique({
    where: { idempotencyKey: record.idempotencyKey },
  });
  if (prior) {
    return {
      localUuid: record.localUuid,
      idempotencyKey: record.idempotencyKey,
      result: 'DUPLICATE',
      serverEntityId: prior.serverEntityId,
      conflictStatus: prior.conflictStatus,
    };
  }

  const created = await prisma.mobileSyncEvent.create({
    data: {
      deviceId: deviceId ?? undefined,
      workerId: workerId ?? undefined,
      localUuid: record.localUuid,
      idempotencyKey: record.idempotencyKey,
      entityType: record.entityType as any,
      result: params.result as any,
      serverEntityId: params.serverEntityId ?? null,
      conflictStatus: params.conflictStatus ?? null,
      deviceTimestamp: record.deviceTimestamp ? new Date(record.deviceTimestamp) : null,
      createdTimestamp: record.createdTimestamp ? new Date(record.createdTimestamp) : null,
      retryCount: record.retryCount ?? 0,
      lastError: params.error ?? null,
    },
  });

  return {
    localUuid: record.localUuid,
    idempotencyKey: record.idempotencyKey,
    result: params.result,
    serverEntityId: created.serverEntityId,
    conflictStatus: created.conflictStatus,
    error: created.lastError,
  };
}

// Last-write-wins conflict check for a mutable server entity. Returns a
// conflict reason string when the server copy is newer than the device capture
// time, otherwise null (safe to apply).
export function detectConflict(
  serverUpdatedAt: Date | null | undefined,
  deviceTimestamp: string | null | undefined
): string | null {
  if (!serverUpdatedAt || !deviceTimestamp) return null;
  const dev = new Date(deviceTimestamp).getTime();
  if (Number.isNaN(dev)) return null;
  return serverUpdatedAt.getTime() > dev ? 'server_newer' : null;
}
