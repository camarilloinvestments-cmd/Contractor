export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') ?? 'by-job';

  try {
    if (type === 'by-job') {
      const jobs = await prisma.job.findMany({
        include: {
          primeContractor: { select: { companyName: true } },
          tasks: { select: { billableAmount: true, costAmount: true, profitAmount: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      const report = (jobs ?? []).map((j: any) => {
        const approved = (j?.tasks ?? []).filter((t: any) => t?.status === 'APPROVED');
        const billable = approved.reduce((s: number, t: any) => s + (t?.billableAmount ?? 0), 0);
        const cost = approved.reduce((s: number, t: any) => s + (t?.costAmount ?? 0), 0);
        const profit = billable - cost;
        return {
          id: j?.id, jobName: j?.jobName, jobNumber: j?.jobNumber, status: j?.status,
          primeContractor: j?.primeContractor?.companyName ?? '',
          billable, cost, profit, margin: billable > 0 ? (profit / billable) * 100 : 0,
          taskCount: j?.tasks?.length ?? 0,
        };
      });
      return NextResponse.json(report);
    }

    if (type === 'by-contractor') {
      const contractors = await prisma.primeContractor.findMany({
        include: {
          jobs: {
            include: { tasks: { select: { billableAmount: true, costAmount: true, profitAmount: true, status: true } } },
          },
        },
      });
      const report = (contractors ?? []).map((c: any) => {
        let billable = 0, cost = 0;
        for (const job of (c?.jobs ?? [])) {
          for (const task of (job?.tasks ?? [])) {
            if (task?.status === 'APPROVED') {
              billable += task?.billableAmount ?? 0;
              cost += task?.costAmount ?? 0;
            }
          }
        }
        return {
          id: c?.id, companyName: c?.companyName,
          jobCount: c?.jobs?.length ?? 0, billable, cost, profit: billable - cost,
          margin: billable > 0 ? ((billable - cost) / billable) * 100 : 0,
        };
      });
      return NextResponse.json(report);
    }

    if (type === 'by-worker') {
      const workers = await prisma.worker.findMany({
        include: {
          tasks: { select: { costAmount: true, status: true, quantity: true } },
        },
      });
      const report = (workers ?? []).map((w: any) => {
        const approved = (w?.tasks ?? []).filter((t: any) => t?.status === 'APPROVED');
        const totalPayout = approved.reduce((s: number, t: any) => s + (t?.costAmount ?? 0), 0);
        return {
          id: w?.id, name: w?.name, workerType: w?.workerType,
          totalTasks: w?.tasks?.length ?? 0, completedTasks: approved?.length ?? 0,
          totalPayout,
        };
      });
      return NextResponse.json(report);
    }

    return NextResponse.json([]);
  } catch (err: any) {
    console.error('Reports error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
