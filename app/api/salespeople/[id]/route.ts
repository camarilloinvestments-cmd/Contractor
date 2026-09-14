export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const sp = await prisma.salesperson.findUnique({
    where: { id },
    include: { _count: { select: { jobs: true, commissionRecords: true } } },
  });
  if (!sp) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(sp);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const body = await req.json();
    const data: any = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.email !== undefined) data.email = body.email ? String(body.email).trim() : null;
    if (body.phone !== undefined) data.phone = body.phone ? String(body.phone).trim() : null;
    if (body.userId !== undefined) data.userId = body.userId || null;
    if (body.notes !== undefined) data.notes = body.notes ?? null;
    if (body.status !== undefined) data.status = body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const sp = await prisma.salesperson.update({ where: { id }, data });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'salesperson.update', entityType: 'Salesperson', entityId: sp.id,
      metadata: { fields: Object.keys(data) }, ...requestMeta(req),
    });
    return NextResponse.json(sp);
  } catch (err: any) {
    console.error('Update salesperson error:', err?.message);
    return NextResponse.json({ error: 'Failed to update salesperson' }, { status: 500 });
  }
}
