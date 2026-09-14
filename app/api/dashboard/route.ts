export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { canManage } from '@/lib/rbac';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManage(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const [activeJobs, pendingReviews, totalJobs, recentJobs] = await Promise.all([
      prisma.job.count({ where: { status: { in: ['ACTIVE', 'IN_PROGRESS'] } } }),
      prisma.job.count({ where: { status: 'UNDER_REVIEW' } }),
      prisma.job.count(),
      prisma.job.findMany({
        take: 5,
        orderBy: { updatedAt: 'desc' },
        include: { primeContractor: { select: { companyName: true } }, _count: { select: { tasks: true } } },
      }),
    ]);

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const approvedTasks = await prisma.task.findMany({
      where: { status: 'APPROVED' },
      select: { billableAmount: true, costAmount: true, profitAmount: true },
    });

    const monthInvoices = await prisma.invoice.findMany({
      where: { createdAt: { gte: startOfMonth } },
      select: { total: true },
    });

    const totalRevenue = approvedTasks.reduce((sum: number, t: any) => sum + (t?.billableAmount ?? 0), 0);
    const totalCost = approvedTasks.reduce((sum: number, t: any) => sum + (t?.costAmount ?? 0), 0);
    const totalProfit = approvedTasks.reduce((sum: number, t: any) => sum + (t?.profitAmount ?? 0), 0);
    const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const monthlyRevenue = monthInvoices.reduce((sum: number, i: any) => sum + (i?.total ?? 0), 0);

    return NextResponse.json({
      activeJobs,
      pendingReviews,
      totalJobs,
      totalRevenue,
      totalCost,
      totalProfit,
      margin,
      monthlyRevenue,
      recentJobs: (recentJobs ?? []).map((j: any) => ({
        id: j?.id,
        jobName: j?.jobName,
        jobNumber: j?.jobNumber,
        status: j?.status,
        primeContractor: j?.primeContractor?.companyName ?? '',
        taskCount: j?._count?.tasks ?? 0,
        updatedAt: j?.updatedAt,
      })),
    });
  } catch (err: any) {
    console.error('Dashboard error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
