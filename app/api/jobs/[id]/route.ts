export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { canManage } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const job = await prisma.job.findUnique({
    where: { id },
    include: {
      primeContractor: true,
      tasks: {
        include: {
          taskType: true,
          worker: { select: { id: true, name: true, workerType: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      activityLogs: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { worker: { select: { name: true } } },
      },
    },
  });
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(job);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManage(session.user.role)) return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 });
  const { id } = await params;

  try {
    const body = await request.json();
    const updated = await prisma.job.update({ where: { id }, data: body });

    // Log status change
    if (body.status) {
      await prisma.activityLog.create({
        data: {
          jobId: id,
          activityType: 'STATUS_UPDATE',
          description: `Job status changed to ${body.status}`,
        },
      });
    }
    return NextResponse.json(updated);
  } catch (err: any) {
    console.error('Update job error:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
