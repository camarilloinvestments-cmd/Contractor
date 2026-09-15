// Operator-approved conversion of an analyzed intake into a real Work Order.
//
// This is the ONLY place an intake becomes operational/financial data, and it is
// always driven by explicit operator decisions - never by the AI draft alone.
// The AI's device_id / suggested billing code is advisory: a Task only receives a
// billing code when the operator confirms a jobCode that resolves in the WO's
// PINNED price book version. Everything financial derives from that pinned
// snapshot + operator-supplied payout, never from anything OpenAI returned.
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { allocateNumber } from '@/lib/documents/numbering';
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

// Intake statuses that represent a completed, analyzed draft eligible for
// approval. A Work Order may ONLY be created from one of these post-analysis
// states - never from NEW/ANALYZING/FAILED (no completed draft) nor from a
// terminal/in-flight state (REJECTED/APPROVING/IMPORTED).
export const APPROVABLE_STATUSES = ['READY', 'NEEDS_REVIEW'] as const;

// Minimal shape the authoritative review gate needs from an item row.
type ReviewableItem = {
  id: string;
  deviceId: string | null;
  requiresReview: boolean;
  possibleDuplicate: boolean;
  reviewResolution: string;
};

// Authoritative, server-enforced review gate (Blocker 3). Given the CURRENT item
// rows and the operator decisions, return the items that may become tasks. A
// flagged item (requiresReview OR possibleDuplicate) must carry an explicit,
// PERSISTED resolution: EXCLUDED is omitted, only CONFIRMED/CORRECTED proceed,
// and a still-PENDING included flagged item REJECTS the whole approval. This
// must be evaluated on rows read INSIDE the approval transaction so it cannot
// race a concurrent operator PATCH.
function selectOperationalItems<T extends ReviewableItem>(
  items: T[],
  decisionsByItem: Map<string, ItemDecision>,
): T[] {
  const included = items.filter((it) => decisionsByItem.has(it.id));
  if (included.length === 0) {
    throw new AiApproveError('Select at least one item to create as a task');
  }
  const operational: T[] = [];
  for (const it of included) {
    const d = decisionsByItem.get(it.id)!;
    if (!d.taskTypeId) {
      throw new AiApproveError(`Item ${it.deviceId ?? it.id} requires a task type before it can be created`);
    }
    const flagged = it.requiresReview || it.possibleDuplicate;
    if (flagged) {
      if (it.reviewResolution === 'EXCLUDED') {
        continue; // operator excluded this flagged item - omit, do not task
      }
      if (it.reviewResolution !== 'CONFIRMED' && it.reviewResolution !== 'CORRECTED') {
        throw new AiApproveError(
          `Item ${it.deviceId ?? it.id} is flagged for review and must be resolved (confirm, correct, or exclude) before approval`,
        );
      }
    }
    operational.push(it);
  }
  if (operational.length === 0) {
    throw new AiApproveError('No items remain to create as tasks after review exclusions');
  }
  return operational;
}

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
  // Only a completed, analyzed draft (READY / NEEDS_REVIEW) may be approved.
  // NEW/ANALYZING/FAILED have no completed draft; APPROVING/IMPORTED are handled
  // by the idempotency guard / the transactional claim below. This is an early
  // fail-fast; the AUTHORITATIVE gate is the conditional claim inside the tx.
  if (!(APPROVABLE_STATUSES as readonly string[]).includes(intake.status)) {
    throw new AiApproveError(
      `Intake is not in an approvable state (status ${intake.status}); only an analyzed draft (READY or NEEDS_REVIEW) can be approved`,
    );
  }
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

  // Early fail-fast on the pre-transaction snapshot (cheap client feedback). The
  // AUTHORITATIVE evaluation happens on rows re-read INSIDE the transaction so a
  // concurrent PATCH cannot flip a resolution underneath us.
  selectOperationalItems(intake.items, decisionsByItem);
  const projectId = intake.projectId;

  // Resolve + pin the exact (prime, project, book, version) - operator override
  // honored. Read-only; safe to resolve before opening the write transaction.
  const pin = await resolveWorkOrderPin({
    projectId,
    overrideVersionId: input.overrideVersionId ?? null,
  });

  // Blocker 2 - atomic, concurrency-safe conversion. Everything (claim + WO +
  // Tasks + price snapshots + item->task links + resultingJobId + IMPORTED) is
  // committed or rolled back together inside ONE interactive transaction. A
  // concurrency-safe claim (status -> APPROVING via conditional updateMany)
  // ensures a single intake yields at most one work order even under concurrent
  // approvals or a retried lost-response request.
  const MAX_ATTEMPTS = 5;
  let result: { job: Awaited<ReturnType<typeof prisma.job.create>>; taskCount: number } | null = null;
  let alreadyImported: { job: Awaited<ReturnType<typeof prisma.job.findUnique>>; } | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const txResult = await prisma.$transaction(
        async (tx) => {
          // (1) Concurrency-safe claim: only ONE caller can move a fresh intake
          // into APPROVING. Others match zero rows and branch on the live state.
          const claim = await tx.aiWorkIntake.updateMany({
            where: {
              id: intakeId,
              resultingJobId: null,
              // Authoritative claim: only a completed, analyzed draft may be
              // moved into APPROVING. Anything else (NEW/ANALYZING/FAILED/
              // APPROVING/IMPORTED/REJECTED) matches zero rows.
              status: { in: ['READY', 'NEEDS_REVIEW'] },
            },
            data: { status: 'APPROVING' },
          });
          if (claim.count !== 1) {
            const cur = await tx.aiWorkIntake.findUnique({
              where: { id: intakeId },
              select: { resultingJobId: true, status: true },
            });
            if (cur?.resultingJobId) {
              const existing = await tx.job.findUnique({ where: { id: cur.resultingJobId } });
              return { kind: 'existing' as const, job: existing };
            }
            throw new AiApproveError('Intake is already being approved or imported');
          }

          // (1b) AUTHORITATIVE review gate: re-read the item rows INSIDE the
          // transaction and re-evaluate the gate on them, so a concurrent PATCH
          // that flipped a resolution (e.g. CONFIRMED -> PENDING) after our
          // pre-tx snapshot cannot authorize a stale task. The claim above set
          // this intake to APPROVING, which the PATCH route refuses to edit, so
          // these rows are now stable for the remainder of the transaction.
          const freshItems = await tx.aiIntakeItem.findMany({ where: { intakeId } });
          const operational = selectOperationalItems(freshItems, decisionsByItem);

          // (2) Allocate the WO number on the SAME tx client.
          const jobNumber = await allocateNumber('WORKORDER', tx);

          // (3) Create the work order (DRAFT), pinned.
          const job = await tx.job.create({
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
          });

          // (4) One Task per operational item, all on the same tx.
          const createdTaskIds: { itemId: string; taskId: string }[] = [];
          for (const it of operational) {
            const d = decisionsByItem.get(it.id)!;
            const qty = typeof d.quantity === 'number' && d.quantity > 0 ? d.quantity : 1;
            const description = d.description ?? it.instructions ?? it.deviceId ?? null;
            // Blocker 4 - durable, non-financial device/work identifier snapshot.
            const sourceWorkRef = it.deviceId ?? null;

            let taskId: string;
            if (d.jobCode && d.jobCode.trim()) {
              const task = await addBillingCodeToTask({
                jobId: job.id,
                taskTypeId: d.taskTypeId,
                jobCode: d.jobCode.trim(),
                quantity: qty,
                workerId: d.workerId ?? null,
                workerPayoutRate: typeof d.workerPayoutRate === 'number' ? d.workerPayoutRate : 0,
                description,
                sourceWorkRef,
                tx,
              });
              taskId = task.id;
            } else {
              const payoutRate = typeof d.workerPayoutRate === 'number' ? d.workerPayoutRate : 0;
              const costAmount = Math.round(payoutRate * qty);
              const task = await tx.task.create({
                data: {
                  jobId: job.id,
                  taskTypeId: d.taskTypeId,
                  description,
                  quantity: qty,
                  billingRate: 0,
                  workerPayoutRate: payoutRate,
                  workerId: d.workerId ?? null,
                  sourceWorkRef,
                  billableAmount: 0,
                  costAmount,
                  profitAmount: -costAmount,
                },
              });
              taskId = task.id;
            }
            createdTaskIds.push({ itemId: it.id, taskId });
          }

          // (5) Link items -> tasks (in the same tx).
          for (const { itemId, taskId } of createdTaskIds) {
            await tx.aiIntakeItem.update({
              where: { id: itemId },
              data: {
                resultingTaskId: taskId,
                reviewStatus: 'APPROVED',
                confirmedJobCode: decisionsByItem.get(itemId)?.jobCode?.trim() || null,
                mappedTaskTypeId: decisionsByItem.get(itemId)?.taskTypeId || null,
              },
            });
          }

          // (6) Finalize: IMPORTED + resultingJobId. Committed atomically with all
          // of the above; if anything above threw, the APPROVING claim rolls back.
          await tx.aiWorkIntake.update({
            where: { id: intakeId },
            data: {
              status: 'IMPORTED',
              approvedById: actor.id,
              approvedAt: new Date(),
              resultingJobId: job.id,
            },
          });

          return { kind: 'created' as const, job, taskCount: createdTaskIds.length };
        },
        { timeout: 20000 },
      );

      if (txResult.kind === 'existing') {
        alreadyImported = { job: txResult.job };
      } else {
        result = { job: txResult.job, taskCount: txResult.taskCount };
      }
      break;
    } catch (err) {
      // Retry only on a unique-violation (concurrent number allocation). The
      // aborted transaction rolls back the APPROVING claim, so a retry re-claims
      // cleanly. Any other error propagates (transaction already rolled back).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && attempt < MAX_ATTEMPTS - 1) {
        continue;
      }
      throw err;
    }
  }

  if (alreadyImported) {
    return { job: alreadyImported.job, alreadyImported: true };
  }
  if (!result) {
    throw new AiApproveError('Unable to allocate a work order number after multiple attempts');
  }

  await writeAudit({
    actor, action: 'ai_intake.approved', entityType: 'AiWorkIntake', entityId: intakeId,
    metadata: { jobId: result.job.id, jobNumber: result.job.jobNumber, itemCount: result.taskCount },
    ...reqMeta,
  });
  await writeAudit({
    actor, action: 'ai_intake.work_order_created', entityType: 'Job', entityId: result.job.id,
    metadata: { intakeId, intakeNumber: intake.intakeNumber, taskCount: result.taskCount },
    ...reqMeta,
  });

  return { job: result.job, alreadyImported: false, taskCount: result.taskCount };
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
