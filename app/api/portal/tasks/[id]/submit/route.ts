export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const existing = await prisma.task.findUnique({ where: { id }, select: { workerId: true } });
    if (!existing) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    const isManager = session.user.role === 'ADMIN' || session.user.role === 'PROJECT_MANAGER';
    if (!isManager && existing.workerId !== session.user.workerId) {
      return NextResponse.json({ error: 'Forbidden: not your task' }, { status: 403 });
    }

    const task = await prisma.task.update({
      where: { id },
      data: { status: 'SUBMITTED' },
    });

    await prisma.activityLog.create({
      data: {
        jobId: task?.jobId,
        taskId: id,
        workerId: session.user.workerId,
        activityType: 'STATUS_UPDATE',
        description: 'Task submitted for review',
      },
    });

    // Check if all tasks in the job are submitted/approved
    const jobTasks = await prisma.task.findMany({ where: { jobId: task?.jobId } });
    const allSubmitted = (jobTasks ?? []).every((t: any) => t?.status === 'SUBMITTED' || t?.status === 'APPROVED');
    if (allSubmitted) {
      await prisma.job.update({ where: { id: task?.jobId }, data: { status: 'UNDER_REVIEW' } });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Submit task error:', err);
    return NextResponse.json({ error: 'Failed to submit task' }, { status: 500 });
  }
}
