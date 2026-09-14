// Increment 8 (Workstream N/O) — crews CRUD. ADMIN/PM.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
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
  const crews = await prisma.crew.findMany({
    orderBy: { name: 'asc' },
    include: {
      members: { select: { id: true, name: true, workerType: true } },
      vehicles: { select: { id: true, name: true, vehicleNumber: true } },
    },
  });
  return NextResponse.json({ crews });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json();
  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'Crew name is required.' }, { status: 400 });
  }
  const crew = await prisma.crew.create({
    data: {
      name: body.name.trim(),
      subcontractorCompany: body.subcontractorCompany ?? null,
      notes: body.notes ?? null,
      active: body.active ?? true,
    },
  });
  const meta = requestMeta(req);
  await writeAudit({
    actor: { id: session.user.id, email: session.user.email, role: session.user.role },
    action: 'crew.create',
    entityType: 'Crew',
    entityId: crew.id,
    ...meta,
  });
  return NextResponse.json({ crew });
}
