export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';
import { calculateCommission, isEarned, type PlanConfig, type CommissionPlanType, type CommissionEarnedEvent } from '@/lib/commission';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const records = await prisma.commissionRecord.findMany({
    where: { jobId: id },
    include: { salesperson: { select: { id: true, name: true } } },
    orderBy: { calculatedAt: 'desc' },
  });
  return NextResponse.json(records);
}

/**
 * POST computes and RECORDS a commission for the job, snapshotting the plan
 * name/type/earnedEvent and full config at calc time so historical commissions
 * never change when a plan is later edited.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        tasks: { include: { worker: { select: { workerType: true } } } },
        commissionPlan: true,
      },
    });
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    if (!job.salespersonId) return NextResponse.json({ error: 'No salesperson assigned to this job' }, { status: 400 });
    if (!job.commissionPlan) return NextResponse.json({ error: 'No commission plan assigned to this job' }, { status: 400 });

    let revenue = 0;
    let productionCost = 0;
    let totalQuantity = 0;
    for (const t of job.tasks) {
      revenue += t.billableAmount || 0;
      productionCost += t.costAmount || 0;
      totalQuantity += t.quantity || 0;
    }
    const grossProfit = revenue - productionCost - (job.otherDirectCosts || 0);
    const plan = job.commissionPlan;
    const config = (plan.config as PlanConfig) || {};
    const result = calculateCommission(plan.planType as CommissionPlanType, config, {
      revenue,
      grossProfit,
      taskCount: job.tasks.length,
      totalQuantity,
      primeContractorId: job.primeContractorId,
      tasks: job.tasks.map((t) => ({
        taskTypeId: t.taskTypeId,
        quantity: t.quantity || 0,
        billableAmount: t.billableAmount || 0,
        costAmount: t.costAmount || 0,
      })),
    });
    const earned = isEarned(plan.earnedEvent as CommissionEarnedEvent, { status: job.status });

    const record = await prisma.commissionRecord.create({
      data: {
        jobId: job.id,
        salespersonId: job.salespersonId,
        planId: plan.id,
        planName: plan.name,
        planType: plan.planType,
        earnedEvent: plan.earnedEvent,
        rateSnapshot: config as any,
        basisAmount: result.basisAmount,
        commissionAmount: result.commissionAmount,
        status: earned ? 'EARNED' : 'PENDING',
      },
    });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'commission.record', entityType: 'CommissionRecord', entityId: record.id,
      metadata: { jobId: job.id, commissionAmount: record.commissionAmount, status: record.status }, ...requestMeta(req),
    });
    return NextResponse.json(record);
  } catch (err: any) {
    console.error('Record commission error:', err?.message);
    return NextResponse.json({ error: 'Failed to record commission' }, { status: 500 });
  }
}
