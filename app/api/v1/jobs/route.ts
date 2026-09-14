// GET /api/v1/jobs — list jobs (scope: jobs:read).
import { prisma } from '@/lib/prisma';
import { guard, ok } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await guard(req, 'jobs:read');
  if ('res' in g) return g.res;
  const url = new URL(req.url);
  const take = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);
  const jobs = await prisma.job.findMany({
    take,
    orderBy: { createdAt: 'desc' },
    select: { id: true, jobNumber: true, jobName: true, status: true, primeContractorId: true, createdAt: true },
  });
  return ok(jobs, g.requestId);
}
