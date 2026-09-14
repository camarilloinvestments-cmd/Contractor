// Increment 10 — Workstream R: admin / project-manager Field Evidence review list.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || (session.user.role !== 'ADMIN' && session.user.role !== 'PROJECT_MANAGER')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');
  const status = searchParams.get('status');

  const where: Record<string, any> = {};
  if (jobId) where.jobId = jobId;
  if (status) where.status = status;

  const packages = await prisma.fieldEvidencePackage.findMany({
    where,
    orderBy: { submittedAt: 'desc' },
    take: 500,
    include: {
      assets: true,
      job: { select: { jobNumber: true, jobName: true } },
      worker: { select: { name: true, companyName: true } },
      task: { select: { description: true } },
    },
  });

  return NextResponse.json({ packages });
}
