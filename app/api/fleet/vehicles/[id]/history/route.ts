// Increment 8 (Workstream N/O) — historical vehicle telemetry / route history.
// Returns stored breadcrumbs (Source: Geotab) for a vehicle within a date range
// and optional job filter, plus geofence arrival/departure events for context.
// Viewing internal historical location is audited (acceptance #14).
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

function canView(role?: string | null) {
  // Internal fleet history is operational-only; never exposed to customer/prime portal.
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canView(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const url = new URL(req.url);
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  const jobId = url.searchParams.get('jobId');
  const now = new Date();
  const from = fromStr ? new Date(fromStr) : new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const to = toStr ? new Date(toStr) : now;

  const where: any = { vehicleId: id, recordedAt: { gte: from, lte: to } };
  if (jobId) where.jobId = jobId;

  // Validate range up-front so a bad range is a clear 400 (not a silent "no data").
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: 'Invalid date range', reason: 'The From/To dates could not be parsed.' }, { status: 400 });
  }
  if (from.getTime() > to.getTime()) {
    return NextResponse.json({ error: 'Invalid date range', reason: 'From date is after To date.' }, { status: 400 });
  }

  // Any failure here is a LOAD FAILURE (surfaced to the operator with a safe
  // reason) — never collapsed into an empty "no data" result.
  let vehicle, telemetry, events, trips, lastSyncRow;
  try {
    [vehicle, telemetry, events, trips, lastSyncRow] = await Promise.all([
      prisma.fleetVehicle.findUnique({
        where: { id },
        select: { id: true, name: true, vehicleNumber: true, provider: true },
      }),
      prisma.vehicleTelemetry.findMany({ where, orderBy: { recordedAt: 'asc' } }),
      prisma.geoEvent.findMany({
        where: { vehicleId: id, actorType: 'VEHICLE', occurredAt: { gte: from, lte: to }, ...(jobId ? { jobId } : {}) },
        orderBy: { occurredAt: 'asc' },
        include: { job: { select: { id: true, jobNumber: true, jobName: true } } },
      }),
      prisma.vehicleTrip.findMany({ where: { vehicleId: id, startAt: { gte: from, lte: to } }, orderBy: { startAt: 'asc' } }),
      // Most recent stored sample for this vehicle across all time — drives the
      // "last sync" / stale-data indicator independent of the selected range.
      prisma.vehicleTelemetry.findFirst({ where: { vehicleId: id }, orderBy: { recordedAt: 'desc' }, select: { recordedAt: true } }),
    ]);
  } catch (err) {
    console.error('[fleet.vehicle_history] query failed', { vehicleId: id, from: from.toISOString(), to: to.toISOString(), error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: 'Query failed', reason: 'The telemetry store could not be queried. Check database connectivity and the historical feed.' },
      { status: 502 }
    );
  }
  if (!vehicle) return NextResponse.json({ error: 'Not found', reason: 'Vehicle not found.' }, { status: 404 });

  const meta = requestMeta(req);
  await writeAudit({
    actor: { id: session.user.id, email: session.user.email, role: session.user.role },
    action: 'fleet.vehicle_history_view',
    entityType: 'FleetVehicle',
    entityId: id,
    metadata: { from: from.toISOString(), to: to.toISOString(), jobId: jobId ?? null, points: telemetry.length },
    ...meta,
  });

  return NextResponse.json({
    source: 'Geotab',
    vehicle,
    range: { from: from.toISOString(), to: to.toISOString() },
    telemetry,
    events,
    trips,
    count: telemetry.length,
    eventCount: events.length,
    tripCount: trips.length,
    lastSync: lastSyncRow?.recordedAt ? lastSyncRow.recordedAt.toISOString() : null,
  });
}
