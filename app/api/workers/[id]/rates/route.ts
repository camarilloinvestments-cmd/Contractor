export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { canManage } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManage(session.user.role)) return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 });
  const { id } = await params;

  try {
    const body = await request.json();
    const { taskTypeId, ratePerUnit } = body ?? {};
    const rate = await prisma.workerRate.upsert({
      where: { workerId_taskTypeId: { workerId: id, taskTypeId } },
      create: { workerId: id, taskTypeId, ratePerUnit },
      update: { ratePerUnit },
    });
    return NextResponse.json(rate);
  } catch (err: any) {
    console.error('Rate error:', err);
    return NextResponse.json({ error: 'Failed to save rate' }, { status: 500 });
  }
}
