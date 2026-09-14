// Increment 10 — Workstream Q: offline sync batch endpoint.
// The device flushes its offline queue here. Each record is recorded in an
// idempotent ledger (MobileSyncEvent) keyed by idempotencyKey so replays after
// a flaky connection are de-duplicated (DUPLICATE ack) rather than double-applied.
import { NextResponse } from 'next/server';
import { verifyMobileSession } from '@/lib/mobile/auth';
import { recordSyncOutcome, type QueuedRecord, type SyncAck } from '@/lib/mobile/sync';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const v = await verifyMobileSession(req);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const ctx = v.ctx;

  const body = await req.json().catch(() => ({} as any));
  const records: QueuedRecord[] = Array.isArray(body?.records) ? body.records : [];
  if (records.length === 0) return NextResponse.json({ acks: [] });
  if (records.length > 500) {
    return NextResponse.json({ error: 'Batch too large (max 500 records)' }, { status: 400 });
  }

  const acks: SyncAck[] = [];
  for (const record of records) {
    if (!record?.idempotencyKey || !record?.localUuid || !record?.entityType) {
      acks.push({
        localUuid: record?.localUuid ?? '',
        idempotencyKey: record?.idempotencyKey ?? '',
        result: 'REJECTED',
        error: 'Missing idempotencyKey, localUuid or entityType',
      });
      continue;
    }
    try {
      const ack = await recordSyncOutcome({
        deviceId: ctx.deviceId,
        workerId: ctx.workerId,
        record,
        result: 'ACCEPTED',
      });
      acks.push(ack);
    } catch (err: any) {
      acks.push({
        localUuid: record.localUuid,
        idempotencyKey: record.idempotencyKey,
        result: 'REJECTED',
        error: err?.message ?? 'sync error',
      });
    }
  }

  const accepted = acks.filter((a) => a.result === 'ACCEPTED').length;
  const duplicates = acks.filter((a) => a.result === 'DUPLICATE').length;
  await writeAudit({
    actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
    action: 'mobile.sync',
    entityType: 'MobileDevice',
    entityId: ctx.deviceId,
    metadata: { total: records.length, accepted, duplicates, rejected: acks.length - accepted - duplicates },
    ...requestMeta(req),
  });

  return NextResponse.json({ acks });
}
