// Increment 8 (Workstream O) — trigger a fleet telemetry sync. ADMIN/PM only.
// The sync itself resumes from the persisted feed checkpoint and does not
// depend on a browser remaining open.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { runFleetSync } from '@/lib/fleet/sync';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || (session.user.role !== 'ADMIN' && session.user.role !== 'PROJECT_MANAGER')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const summary = await runFleetSync();
  const meta = requestMeta(req);
  await writeAudit({
    actor: { id: session.user.id, email: session.user.email, role: session.user.role },
    action: 'fleet.sync',
    entityType: 'FleetProviderSettings',
    entityId: 'default',
    metadata: { ok: summary.ok, vehiclesUpserted: summary.vehiclesUpserted, telemetryStored: summary.telemetryStored, eventsCreated: summary.eventsCreated },
    ...meta,
  });
  return NextResponse.json({ summary });
}
