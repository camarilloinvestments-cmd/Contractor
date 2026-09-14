// Option A: Work Order (Job) creation flow and Task price snapshotting.
//
// Work Order creation:
//   1. Select Prime.
//   2. Select Project (of that Prime).
//   3. Auto-resolve the Project's default price book.
//   4. Auto-resolve the currently-configured version of that book.
//   5. Optionally accept an authorized override version (of the same book).
//   6. PIN the exact (primeContractorId, projectId, priceBookId,
//      priceBookVersionId) onto the work order. A newer upload later NEVER
//      silently changes an existing work order.
//
// Task snapshotting: when an opaque billing code is added to a WO task, the
// line is resolved ONLY from the WO's pinned version, and the resolved values
// are copied onto the task as immutable historical evidence.
import { prisma } from '@/lib/prisma';
import { resolveProjectDefaultVersion } from '@/lib/projects';

export type WorkOrderPin = {
  primeContractorId: string;
  projectId: string;
  priceBookId: string;
  priceBookVersionId: string;
};

// Resolve the pin for a new work order given a project and an optional override.
// Throws when the project has no resolvable default and no override is supplied,
// or when an override version does not belong to the project's prime.
export async function resolveWorkOrderPin(opts: {
  projectId: string;
  overrideVersionId?: string | null;
}): Promise<WorkOrderPin> {
  const project = await prisma.project.findUnique({
    where: { id: opts.projectId },
    select: { id: true, primeContractorId: true },
  });
  if (!project) throw new Error('Project not found');

  // Authorized override: pin an explicit version instead of the default.
  if (opts.overrideVersionId) {
    const version = await prisma.priceBookVersion.findUnique({
      where: { id: opts.overrideVersionId },
      include: { priceBook: { select: { id: true, primeContractorId: true } } },
    });
    if (!version) throw new Error('Override price book version not found');
    if (version.priceBook.primeContractorId !== project.primeContractorId) {
      throw new Error('Override version does not belong to this project\'s prime contractor');
    }
    return {
      primeContractorId: project.primeContractorId,
      projectId: project.id,
      priceBookId: version.priceBook.id,
      priceBookVersionId: version.id,
    };
  }

  const resolved = await resolveProjectDefaultVersion(opts.projectId);
  if (!resolved) {
    throw new Error('Project has no default price book/version configured; select one or provide an override');
  }
  return {
    primeContractorId: project.primeContractorId,
    projectId: project.id,
    priceBookId: resolved.priceBookId,
    priceBookVersionId: resolved.version.id,
  };
}

// Add an opaque billing code to a work order as a Task, snapshotting the line
// from the WO's PINNED version. Prime billing (what the prime pays us) and
// payout (what we pay the worker) are independent: the payout rate must be
// supplied explicitly and is never derived from the prime rate.
export async function addBillingCodeToTask(input: {
  jobId: string;
  taskTypeId: string;
  jobCode: string;
  quantity: number;
  workerId?: string | null;
  workerPayoutRate?: number; // cents per unit; independent of prime rate
  description?: string | null;
}) {
  const job = await prisma.job.findUnique({
    where: { id: input.jobId },
    select: { id: true, priceBookId: true, priceBookVersionId: true },
  });
  if (!job) throw new Error('Work order not found');
  if (!job.priceBookVersionId) {
    throw new Error('Work order is not pinned to a price book version');
  }

  // Resolve the code ONLY from the pinned version - never from a newer lookup.
  const line = await prisma.priceLine.findFirst({
    where: { priceBookVersionId: job.priceBookVersionId, jobCode: input.jobCode },
  });
  if (!line) {
    throw new Error(`Billing code "${input.jobCode}" not found in the work order's pinned price book version`);
  }

  const primeRatePerUnit = line.ratePerUnit; // cents; prime pays us
  const payoutRate = input.workerPayoutRate ?? 0; // cents; we pay worker
  const calculatedPrimeAmount = Math.round(primeRatePerUnit * input.quantity);
  const costAmount = Math.round(payoutRate * input.quantity);

  return prisma.task.create({
    data: {
      jobId: input.jobId,
      taskTypeId: input.taskTypeId,
      description: input.description ?? line.description,
      quantity: input.quantity,
      billingRate: primeRatePerUnit,
      workerPayoutRate: payoutRate,
      workerId: input.workerId ?? null,
      billableAmount: calculatedPrimeAmount,
      costAmount,
      profitAmount: calculatedPrimeAmount - costAmount,
      // --- historical snapshot (immutable evidence) ---
      priceBookId: job.priceBookId,
      priceBookVersionId: job.priceBookVersionId,
      billingCode: line.jobCode,
      descriptionSnapshot: line.description,
      unitSnapshot: line.unit,
      primeRatePerUnitSnapshot: primeRatePerUnit,
      calculatedPrimeAmount,
    },
  });
}
