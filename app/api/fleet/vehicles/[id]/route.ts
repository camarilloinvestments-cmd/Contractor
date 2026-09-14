// Increment 8 (Workstream N/O) — vehicle detail + assignment updates.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { isStale, ageSeconds } from '@/lib/geo';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const v = await prisma.fleetVehicle.findUnique({
    where: { id },
    include: {
      state: true,
      crew: { select: { id: true, name: true, subcontractorCompany: true } },
      worker: { select: { id: true, name: true, workerType: true } },
      currentJob: { select: { id: true, jobNumber: true, jobName: true, latitude: true, longitude: true } },
    },
  });
  if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    vehicle: { ...v, stale: v.state ? isStale(v.state.recordedAt) : true, lastUpdateAgeSeconds: v.state ? ageSeconds(v.state.recordedAt) : null },
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json();
  const data: any = {};
  if ('assignedCrewId' in body) data.assignedCrewId = body.assignedCrewId ?? null;
  if ('assignedWorkerId' in body) data.assignedWorkerId = body.assignedWorkerId ?? null;
  if ('currentJobId' in body) data.currentJobId = body.currentJobId ?? null;
  if ('subcontractorCompany' in body) data.subcontractorCompany = body.subcontractorCompany ?? null;
  if ('active' in body) data.active = !!body.active;
  if ('name' in body && body.name) data.name = String(body.name).trim();
  if ('vehicleNumber' in body) data.vehicleNumber = body.vehicleNumber ?? null;
  const v = await prisma.fleetVehicle.update({ where: { id }, data });
  const meta = requestMeta(req);
  await writeAudit({
    actor: { id: session.user.id, email: session.user.email, role: session.user.role },
    action: 'fleet.vehicle_update',
    entityType: 'FleetVehicle',
    entityId: id,
    ...meta,
  });
  return NextResponse.json({ vehicle: v });
}
