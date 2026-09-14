export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || undefined;
  const salespeople = await prisma.salesperson.findMany({
    where: status ? { status: status as any } : undefined,
    include: { _count: { select: { jobs: true, commissionRecords: true } } },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
  });
  return NextResponse.json(salespeople);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json();
    if (!body?.name || !String(body.name).trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    const sp = await prisma.salesperson.create({
      data: {
        name: String(body.name).trim(),
        email: body.email ? String(body.email).trim() : null,
        phone: body.phone ? String(body.phone).trim() : null,
        userId: body.userId || null,
        notes: body.notes ?? null,
        status: body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      },
    });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'salesperson.create', entityType: 'Salesperson', entityId: sp.id,
      metadata: { name: sp.name }, ...requestMeta(req),
    });
    return NextResponse.json(sp);
  } catch (err: any) {
    console.error('Create salesperson error:', err?.message);
    return NextResponse.json({ error: 'Failed to create salesperson' }, { status: 500 });
  }
}
