export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const primeContractorId = searchParams.get('primeContractorId');

  const where: any = {};
  if (status) where.status = status;
  if (primeContractorId) where.primeContractorId = primeContractorId;

  const jobs = await prisma.job.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: {
      primeContractor: { select: { companyName: true } },
      _count: { select: { tasks: true } },
    },
  });
  return NextResponse.json(jobs);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const count = await prisma.job.count();
    const jobNumber = `JOB-${String(count + 1).padStart(4, '0')}`;
    const job = await prisma.job.create({
      data: { ...body, jobNumber },
    });
    return NextResponse.json(job);
  } catch (err: any) {
    console.error('Create job error:', err);
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
  }
}
