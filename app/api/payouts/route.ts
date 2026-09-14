export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { canManage } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payouts = await prisma.payoutRecord.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      worker: { select: { name: true, workerType: true } },
      _count: { select: { tasks: true } },
    },
  });

  // Also get workers with payable balances
  const workers = await prisma.worker.findMany({
    include: {
      tasks: {
        where: { status: 'APPROVED', payoutRecordId: null },
        select: { costAmount: true },
      },
    },
  });

  const balances = (workers ?? []).map((w: any) => ({
    id: w?.id,
    name: w?.name,
    workerType: w?.workerType,
    payableBalance: (w?.tasks ?? []).reduce((sum: number, t: any) => sum + (t?.costAmount ?? 0), 0),
    taskCount: w?.tasks?.length ?? 0,
  })).filter((w: any) => (w?.payableBalance ?? 0) > 0);

  return NextResponse.json({ payouts, balances });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManage(session.user.role)) return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 });

  try {
    const body = await request.json();
    const { workerId, notes } = body ?? {};

    const tasks = await prisma.task.findMany({
      where: { workerId, status: 'APPROVED', payoutRecordId: null },
    });

    if ((tasks?.length ?? 0) === 0) {
      return NextResponse.json({ error: 'No approved tasks to pay out' }, { status: 400 });
    }

    const totalAmount = (tasks ?? []).reduce((sum: number, t: any) => sum + (t?.costAmount ?? 0), 0);

    const payout = await prisma.payoutRecord.create({
      data: { workerId, totalAmount, notes },
    });

    // Link tasks to payout
    for (const task of (tasks ?? [])) {
      await prisma.task.update({
        where: { id: task.id },
        data: { payoutRecordId: payout.id },
      });
    }

    return NextResponse.json(payout);
  } catch (err: any) {
    console.error('Create payout error:', err);
    return NextResponse.json({ error: 'Failed to create payout' }, { status: 500 });
  }
}
