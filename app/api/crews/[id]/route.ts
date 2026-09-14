// Increment 8 (Workstream N/O) — crew detail + membership/vehicle assignment. ADMIN/PM.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
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
  const crew = await prisma.crew.findUnique({
    where: { id },
    include: {
      members: { select: { id: true, name: true, workerType: true } },
      vehicles: { select: { id: true, name: true, vehicleNumber: true } },
    },
  });
  if (!crew) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ crew });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json();
  const data: any = {};
  if ('name' in body && body.name) data.name = String(body.name).trim();
  if ('subcontractorCompany' in body) data.subcontractorCompany = body.subcontractorCompany ?? null;
  if ('notes' in body) data.notes = body.notes ?? null;
  if ('active' in body) data.active = !!body.active;
  // Membership assignment (set worker.crewId).
  if (Array.isArray(body.memberIds)) {
    await prisma.worker.updateMany({ where: { crewId: id }, data: { crewId: null } });
    if (body.memberIds.length > 0) {
      await prisma.worker.updateMany({ where: { id: { in: body.memberIds } }, data: { crewId: id } });
    }
  }
  // Vehicle assignment (set vehicle.assignedCrewId).
  if (Array.isArray(body.vehicleIds)) {
    await prisma.fleetVehicle.updateMany({ where: { assignedCrewId: id }, data: { assignedCrewId: null } });
    if (body.vehicleIds.length > 0) {
      await prisma.fleetVehicle.updateMany({ where: { id: { in: body.vehicleIds } }, data: { assignedCrewId: id } });
    }
  }
  const crew = await prisma.crew.update({
    where: { id },
    data,
    include: {
      members: { select: { id: true, name: true, workerType: true } },
      vehicles: { select: { id: true, name: true, vehicleNumber: true } },
    },
  });
  const meta = requestMeta(req);
  await writeAudit({
    actor: { id: session.user.id, email: session.user.email, role: session.user.role },
    action: 'crew.update',
    entityType: 'Crew',
    entityId: id,
    ...meta,
  });
  return NextResponse.json({ crew });
}
