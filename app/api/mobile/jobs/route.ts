// Increment 10 — Workstream P: assigned jobs for the signed-in field worker.
// Role-scoped: a field worker sees only jobs where they have assigned tasks.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyMobileSession } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const v = await verifyMobileSession(req);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });

  const where =
    v.ctx.role === 'ADMIN' || v.ctx.role === 'PROJECT_MANAGER'
      ? {}
      : v.ctx.workerId
        ? { tasks: { some: { workerId: v.ctx.workerId } } }
        : { id: '__none__' };

  const jobs = await prisma.job.findMany({
    where,
    orderBy: { dueDate: 'asc' },
    take: 200,
    select: {
      id: true, jobNumber: true, jobName: true, status: true,
      address: true, city: true, state: true, zip: true,
      latitude: true, longitude: true, geofenceRadiusFeet: true,
      startDate: true, dueDate: true,
      primeContractor: { select: { companyName: true } },
    },
  });
  return NextResponse.json({ jobs });
}
