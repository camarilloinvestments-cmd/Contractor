// Increment 8 (Workstream N/O) — fleet vehicle inventory.
// GET: list vehicles with current state + assignments (ADMIN/PM/DISPATCH).
// POST: create a manual (non-Geotab) vehicle record (ADMIN/PM).
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { isStale, ageSeconds } from '@/lib/geo';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

export async function GET() {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const vehicles = await prisma.fleetVehicle.findMany({
    orderBy: { name: 'asc' },
    include: {
      state: true,
      crew: { select: { id: true, name: true } },
      worker: { select: { id: true, name: true } },
      currentJob: { select: { id: true, jobNumber: true, jobName: true } },
    },
  });
  const rows = vehicles.map((v) => ({
    ...v,
    stale: v.state ? isStale(v.state.recordedAt) : true,
    lastUpdateAgeSeconds: v.state ? ageSeconds(v.state.recordedAt) : null,
  }));
  return NextResponse.json({ vehicles: rows });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json();
  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'Vehicle name is required.' }, { status: 400 });
  }
  const v = await prisma.fleetVehicle.create({
    data: {
      provider: 'GEOTAB',
      geotabDeviceId: null,
      name: body.name.trim(),
      vehicleNumber: body.vehicleNumber ?? null,
      vin: body.vin ?? null,
      make: body.make ?? null,
      model: body.model ?? null,
      year: typeof body.year === 'number' ? body.year : null,
      licensePlate: body.licensePlate ?? null,
      active: body.active ?? true,
      assignedCrewId: body.assignedCrewId ?? null,
      assignedWorkerId: body.assignedWorkerId ?? null,
      subcontractorCompany: body.subcontractorCompany ?? null,
      currentJobId: body.currentJobId ?? null,
    },
  });
  const meta = requestMeta(req);
  await writeAudit({
    actor: { id: session.user.id, email: session.user.email, role: session.user.role },
    action: 'fleet.vehicle_create',
    entityType: 'FleetVehicle',
    entityId: v.id,
    ...meta,
  });
  return NextResponse.json({ vehicle: v });
}
