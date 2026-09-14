export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { canManage } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const contractor = await prisma.primeContractor.findUnique({
    where: { id },
    include: {
      rateCards: { include: { taskType: true }, orderBy: { taskType: { name: 'asc' } } },
      jobs: { orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, jobName: true, jobNumber: true, status: true } },
    },
  });
  if (!contractor) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(contractor);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManage(session.user.role)) return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 });
  const { id } = await params;

  try {
    const body = await request.json();
    const updated = await prisma.primeContractor.update({ where: { id }, data: body });
    return NextResponse.json(updated);
  } catch (err: any) {
    console.error('Update contractor error:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
