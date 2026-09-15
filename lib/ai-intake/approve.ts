// Operator-approved conversion of an analyzed intake into a real Work Order.
//
// This is the ONLY place an intake becomes operational/financial data, and it is
// always driven by explicit operator decisions - never by the AI draft alone.
// The AI's device_id / suggested billing code is advisory: a Task only receives a
// billing code when the operator confirms a jobCode that resolves in the WO's
// PINNED price book version. Everything financial derives from that pinned
// snapshot + operator-supplied payout, never from anything OpenAI returned.
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { createWithNumber } from '@/lib/documents/numbering';
import { resolveWorkOrderPin, addBillingCodeToTask } from '@/lib/work-orders';
import type { ActorMeta, ReqMeta } from './analyze';

export class AiApproveError extends Error {}

export type ItemDecision = {
  itemId: string;
  taskTypeId: string; // REQUIRED - Task.taskTypeId is a mandatory FK
  jobCode?: string | null; // operator-confirmed billing code (optional)
  quantity?: number | null;
  workerId?: string | null;
  workerPayoutRate?: number | null; // cents/unit; independent of prime rate
  description?: string | null;
};

export type ApproveInput = {
  jobName: string;
  overrideVersionId?: string | null;
  itemDecisions: ItemDecision[];
};

// Idempotent: if the intake already produced a work order, return it unchanged.
export async function approveIntake(
  intakeId: string,
  input: ApproveInput,
  actor: ActorMeta,
  reqMeta: ReqMeta = {},
) {
  const intake = await prisma.aiWorkIntake.findUnique({
    where: { id: intakeId },
    include: { items: true },
  });
  if (!intake) throw new AiApproveError('Intake not found');

  // Idempotency guard - never create a second WO for the same intake.
  if (intake.resultingJobId) {
    const existing = await prisma.job.findUnique({ where: { id: intake.resultingJobId } });
    if (existing) return { job: existing, alreadyImported: true };
  }

  if (intake.status === 'REJECTED') throw new AiApproveError('Intake has been rejected');
  if (!intake.projectId) {
    throw new AiApproveError('Intake has no project selected; a project is required to create a work order');
  }
  if (!input.jobName || !input.jobName.trim()) {
    throw new AiApproveError('jobName is required');
  }

  const decisionsByItem = new Map<string, ItemDecision>();
  for (const d of input.itemDecisions || []) {
    if (!d.itemId) continue;
    decisionsByItem.set(d.itemId, d);
  }

  // Only items the operator chose to include (has a decision) become tasks.
  // Rejected/skipped items are simply omitted.
  const included = intake.items.filter((it) => decisionsByItem.has(it.id));
  if (included.length === 0) {
    throw new AiApproveError('Select at least one item to create as a task');
  }
  for (const it of included) {
    const d = decisionsByItem.get(it.id)!;
    if (!d.taskTypeId) {
      throw new AiApproveError(`Item ${it.deviceId ?? it.id} requires a task type before it can be created`);
    }
  }

  // Resolve + pin the exact (prime, project, book, version) - operator override honored.
  const pin = await resolveWorkOrderPin({
    projectId: intake.projectId,
    overrideVersionId: input.overrideVersionId ?? null,
  });

  // Create the work order (DRAFT) with a concurrency-safe number.
  const job = await createWithNumber('WORKORDER', (jobNumber) =>
    prisma.job.create({
      data: {
        jobNumber,
        jobName: input.jobName.trim(),
        primeContractorId: pin.primeContractorId,
        projectId: pin.projectId,
        priceBookId: pin.priceBookId,
        priceBookVersionId: pin.priceBookVersionId,
        status: 'DRAFT',
        notes: `Created from AI work intake ${intake.intakeNumber}`,
      },
    }),
  );

  // Create one Task per included item. Billing-code tasks snapshot from the
  // pinned version; items without a confirmed jobCode become plain tasks.
  const createdTaskIds: { itemId: string; taskId: string }[] = [];
  for (const it of included) {
    const d = decisionsByItem.get(it.id)!;
    const qty = typeof d.quantity === 'number' && d.quantity > 0 ? d.quantity : 1;
    const description = d.description ?? it.instructions ?? it.deviceId ?? null;

    let taskId: string;
    if (d.jobCode && d.jobCode.trim()) {
      // Operator-confirmed billing code -> resolve from pinned version.
      const task = await addBillingCodeToTask({
        jobId: job.id,
        taskTypeId: d.taskTypeId,
        jobCode: d.jobCode.trim(),
        quantity: qty,
        workerId: d.workerId ?? null,
        workerPayoutRate: typeof d.workerPayoutRate === 'number' ? d.workerPayoutRate : 0,
        description,
      });
      taskId = task.id;
    } else {
      // Plain task (no billing code yet) - no prime rate snapshot.
      const payoutRate = typeof d.workerPayoutRate === 'number' ? d.workerPayoutRate : 0;
      const costAmount = Math.round(payoutRate * qty);
      const task = await prisma.task.create({
        data: {
          jobId: job.id,
          taskTypeId: d.taskTypeId,
          description,
          quantity: qty,
          billingRate: 0,
          workerPayoutRate: payoutRate,
          workerId: d.workerId ?? null,
          billableAmount: 0,
          costAmount,
          profitAmount: -costAmount,
        },
      });
      taskId = task.id;
    }
    createdTaskIds.push({ itemId: it.id, taskId });
  }

  // Link items -> tasks and mark the intake IMPORTED.
  await prisma.$transaction([
    ...createdTaskIds.map(({ itemId, taskId }) =>
      prisma.aiIntakeItem.update({
        where: { id: itemId },
        data: {
          resultingTaskId: taskId,
          reviewStatus: 'APPROVED',
          confirmedJobCode: decisionsByItem.get(itemId)?.jobCode?.trim() || null,
          mappedTaskTypeId: decisionsByItem.get(itemId)?.taskTypeId || null,
        },
      }),
    ),
    prisma.aiWorkIntake.update({
      where: { id: intakeId },
      data: {
        status: 'IMPORTED',
        approvedById: actor.id,
        approvedAt: new Date(),
        resultingJobId: job.id,
      },
    }),
  ]);

  await writeAudit({
    actor, action: 'ai_intake.approved', entityType: 'AiWorkIntake', entityId: intakeId,
    metadata: { jobId: job.id, jobNumber: job.jobNumber, itemCount: createdTaskIds.length },
    ...reqMeta,
  });
  await writeAudit({
    actor, action: 'ai_intake.work_order_created', entityType: 'Job', entityId: job.id,
    metadata: { intakeId, intakeNumber: intake.intakeNumber, taskCount: createdTaskIds.length },
    ...reqMeta,
  });

  return { job, alreadyImported: false, taskCount: createdTaskIds.length };
}

export async function rejectIntake(
  intakeId: string,
  reason: string | null,
  actor: ActorMeta,
  reqMeta: ReqMeta = {},
) {
  const intake = await prisma.aiWorkIntake.findUnique({ where: { id: intakeId } });
  if (!intake) throw new AiApproveError('Intake not found');
  if (intake.resultingJobId) {
    throw new AiApproveError('Intake already produced a work order and cannot be rejected');
  }
  const updated = await prisma.aiWorkIntake.update({
    where: { id: intakeId },
    data: {
      status: 'REJECTED',
      rejectedById: actor.id,
      rejectedAt: new Date(),
      rejectionReason: reason ?? null,
    },
  });
  await writeAudit({
    actor, action: 'ai_intake.rejected', entityType: 'AiWorkIntake', entityId: intakeId,
    metadata: { reason: reason ?? null }, ...reqMeta,
  });
  return updated;
}
