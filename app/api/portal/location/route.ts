// Increment 8 (Workstream N/O) — field-worker mobile GPS ingest.
// Records a continuous mobile-worker breadcrumb (LocationSource.MOBILE_APP),
// kept SEPARATE from truck (Geotab) telemetry and from ActivityLog evidence
// GPS. Also evaluates job geofences for the worker actor (WORKER_ARRIVED /
// WORKER_LEFT), distinct from vehicle events.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { evaluateGeofences } from '@/lib/fleet/sync';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { workerId: true } });
  const workerId = u?.workerId;
  if (!workerId) return NextResponse.json({ error: 'No worker profile linked to this account.' }, { status: 400 });

  const body = await req.json();
  const lat = Number(body.latitude);
  const lng = Number(body.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'Valid latitude and longitude are required.' }, { status: 400 });
  }
  const recordedAt = body.recordedAt ? new Date(body.recordedAt) : new Date();

  const loc = await prisma.workerLocation.create({
    data: {
      workerId,
      source: 'MOBILE_APP',
      latitude: lat,
      longitude: lng,
      recordedAt,
      accuracy: typeof body.accuracy === 'number' ? body.accuracy : null,
      jobId: body.jobId ?? null,
    },
  });

  const eventsCreated = await evaluateGeofences({
    actorType: 'WORKER',
    workerId,
    latitude: lat,
    longitude: lng,
    source: 'MOBILE_APP',
    occurredAt: recordedAt,
    providerRef: null,
  });

  return NextResponse.json({ ok: true, location: loc, eventsCreated });
}
