export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const worker = await prisma.worker.findUnique({
    where: { id },
    include: {
      rates: { include: { taskType: true }, orderBy: { taskType: { name: 'asc' } } },
      tasks: {
        include: { taskType: true, job: { select: { jobName: true, jobNumber: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
      user: { select: { id: true, email: true } },
    },
  });
  if (!worker) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const payableBalance = await prisma.task.aggregate({
    where: { workerId: id, status: 'APPROVED', payoutRecordId: null },
    _sum: { costAmount: true },
  });

  return NextResponse.json({ ...worker, payableBalance: payableBalance?._sum?.costAmount ?? 0 });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const body = await request.json();
    const updated = await prisma.worker.update({ where: { id }, data: body });
    return NextResponse.json(updated);
  } catch (err: any) {
    console.error('Update worker error:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
