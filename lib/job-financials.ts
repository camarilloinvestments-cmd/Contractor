import { prisma } from '@/lib/prisma';
import { calculateCommission, isEarned, type PlanConfig, type CommissionPlanType, type CommissionEarnedEvent } from '@/lib/commission';

export type FinancialTaskRow = {
  id: string;
  taskTypeName: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  billingRate: number; // cents/unit
  billableAmount: number; // cents
  costAmount: number; // cents
  workerName: string | null;
  workerType: string | null; // SUBCONTRACTOR | IN_HOUSE | null
};

export type JobFinancials = {
  jobId: string;
  revenue: number;
  subcontractorCost: number;
  inHouseCost: number;
  unassignedCost: number;
  salesCommission: number;
  commissionIsRecorded: boolean; // true if from recorded CommissionRecords, false if live preview
  otherDirectCosts: number;
  grossContribution: number;
  grossMarginPct: number; // 0-100
  salesperson: { id: string; name: string } | null;
  commissionPlan: { id: string; name: string; planType: string; earnedEvent: string } | null;
  commissionEarned: boolean;
  tasks: FinancialTaskRow[];
};

/**
 * Computes the full financial summary for a job, including commission.
 * Commission uses recorded CommissionRecords when present (historical/pinned),
 * otherwise a live preview from the job's assigned plan + salesperson.
 */
export async function getJobFinancials(jobId: string): Promise<JobFinancials | null> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      tasks: {
        include: {
          taskType: true,
          worker: { select: { id: true, name: true, workerType: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      salesperson: { select: { id: true, name: true } },
      commissionPlan: true,
      commissionRecords: { where: { status: { not: 'VOID' } } },
    },
  });
  if (!job) return null;

  let revenue = 0;
  let subcontractorCost = 0;
  let inHouseCost = 0;
  let unassignedCost = 0;
  let totalQuantity = 0;
  const taskRows: FinancialTaskRow[] = [];

  for (const t of job.tasks) {
    revenue += t.billableAmount || 0;
    totalQuantity += t.quantity || 0;
    const wt = t.worker?.workerType ?? null;
    if (wt === 'SUBCONTRACTOR') subcontractorCost += t.costAmount || 0;
    else if (wt === 'IN_HOUSE') inHouseCost += t.costAmount || 0;
    else unassignedCost += t.costAmount || 0;
    taskRows.push({
      id: t.id,
      taskTypeName: t.taskType?.name ?? 'Unknown',
      description: t.description ?? null,
      quantity: t.quantity || 0,
      unit: t.taskType?.unitOfMeasure ?? null,
      billingRate: t.billingRate || 0,
      billableAmount: t.billableAmount || 0,
      costAmount: t.costAmount || 0,
      workerName: t.worker?.name ?? null,
      workerType: wt,
    });
  }

  const productionCost = subcontractorCost + inHouseCost + unassignedCost;
  const grossProfitBeforeCommission = revenue - productionCost - (job.otherDirectCosts || 0);

  // Commission: prefer recorded records; else live preview
  let salesCommission = 0;
  let commissionIsRecorded = false;
  let commissionEarned = false;

  if (job.commissionRecords.length > 0) {
    salesCommission = job.commissionRecords.reduce((s, r) => s + (r.commissionAmount || 0), 0);
    commissionIsRecorded = true;
    commissionEarned = job.commissionRecords.some((r) => r.status === 'EARNED' || r.status === 'PAID');
  } else if (job.commissionPlan && job.salespersonId) {
    const res = calculateCommission(
      job.commissionPlan.planType as CommissionPlanType,
      (job.commissionPlan.config as PlanConfig) || {},
      {
        revenue,
        grossProfit: grossProfitBeforeCommission,
        taskCount: job.tasks.length,
        totalQuantity,
        primeContractorId: job.primeContractorId,
        tasks: job.tasks.map((t) => ({
          taskTypeId: t.taskTypeId,
          quantity: t.quantity || 0,
          billableAmount: t.billableAmount || 0,
          costAmount: t.costAmount || 0,
        })),
      },
    );
    salesCommission = res.commissionAmount;
    commissionEarned = isEarned(job.commissionPlan.earnedEvent as CommissionEarnedEvent, { status: job.status });
  }

  const grossContribution = revenue - productionCost - salesCommission - (job.otherDirectCosts || 0);
  const grossMarginPct = revenue > 0 ? (grossContribution / revenue) * 100 : 0;

  return {
    jobId: job.id,
    revenue,
    subcontractorCost,
    inHouseCost,
    unassignedCost,
    salesCommission,
    commissionIsRecorded,
    otherDirectCosts: job.otherDirectCosts || 0,
    grossContribution,
    grossMarginPct,
    salesperson: job.salesperson ? { id: job.salesperson.id, name: job.salesperson.name } : null,
    commissionPlan: job.commissionPlan
      ? { id: job.commissionPlan.id, name: job.commissionPlan.name, planType: job.commissionPlan.planType, earnedEvent: job.commissionPlan.earnedEvent }
      : null,
    commissionEarned,
    tasks: taskRows,
  };
}
