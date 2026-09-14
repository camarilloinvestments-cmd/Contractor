// Increment 10 — Workstream P: assigned tasks (with requirements) for the worker.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyMobileSession } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const v = await verifyMobileSession(req);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const url = new URL(req.url);
  const jobId = url.searchParams.get('jobId') || undefined;

  const isManager = v.ctx.role === 'ADMIN' || v.ctx.role === 'PROJECT_MANAGER';
  const where: any = { ...(jobId ? { jobId } : {}) };
  if (!isManager) {
    if (!v.ctx.workerId) return NextResponse.json({ tasks: [] });
    where.workerId = v.ctx.workerId;
  }

  const tasks = await prisma.task.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    take: 500,
    select: {
      id: true, jobId: true, description: true, quantity: true, status: true,
      taskType: { select: { name: true, unitOfMeasure: true } },
      job: { select: { jobNumber: true, jobName: true, address: true, city: true, state: true, latitude: true, longitude: true, geofenceRadiusFeet: true } },
    },
  });
  return NextResponse.json({ tasks });
}
