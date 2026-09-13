export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workerId = session.user.workerId;
  if (!workerId) return NextResponse.json([]);

  const tasks = await prisma.task.findMany({
    where: { workerId },
    include: {
      job: {
        include: { primeContractor: { select: { companyName: true } } },
      },
      taskType: true,
    },
    orderBy: { job: { updatedAt: 'desc' } },
  });

  // Group by job
  const jobMap: Record<string, any> = {};
  for (const task of (tasks ?? [])) {
    const jobId = task?.jobId;
    if (!jobId) continue;
    if (!jobMap[jobId]) {
      jobMap[jobId] = {
        ...task?.job,
        tasks: [],
      };
    }
    jobMap[jobId].tasks.push({
      id: task?.id,
      taskType: task?.taskType,
      quantity: task?.quantity,
      status: task?.status,
      description: task?.description,
    });
  }

  return NextResponse.json(Object.values(jobMap));
}
