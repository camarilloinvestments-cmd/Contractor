// Duplicate detection performed BEFORE any work order is created.
//
// Blocker 4 - detection keys off a DURABLE, NON-FINANCIAL work/device identifier
// (Task.sourceWorkRef), NOT the billing code (an opaque, reusable financial
// token). A proposed device is flagged as a POSSIBLE DUPLICATE when an open work
// order for the same prime/project already has a task whose sourceWorkRef equals
// that device id. A legacy substring scan over description/billingCode is kept
// ONLY as a fallback for pre-existing manual tasks created before sourceWorkRef
// existed. Detection only RAISES a review flag; it never blocks or auto-merges
// - the operator decides.
import { prisma } from '@/lib/prisma';

export type DuplicateHit = {
  deviceId: string;
  jobId: string;
  jobNumber: string;
  taskId: string;
  matchedBy: 'sourceWorkRef' | 'legacyText';
};

const OPEN_JOB_STATUSES = ['DRAFT', 'ACTIVE', 'IN_PROGRESS', 'UNDER_REVIEW'];

// For the given prime/project and a set of device ids, return any existing open
// work-order tasks that appear to reference the same device id.
export async function findDuplicates(opts: {
  primeContractorId: string;
  projectId?: string | null;
  deviceIds: string[];
}): Promise<DuplicateHit[]> {
  const ids = Array.from(new Set(opts.deviceIds.map((d) => d.trim()).filter(Boolean)));
  if (!ids.length) return [];

  const jobs = await prisma.job.findMany({
    where: {
      primeContractorId: opts.primeContractorId,
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      status: { in: OPEN_JOB_STATUSES as any },
    },
    select: {
      id: true,
      jobNumber: true,
      tasks: { select: { id: true, description: true, billingCode: true, sourceWorkRef: true } },
    },
  });

  const idSet = new Set(ids.map((d) => d.toLowerCase()));
  const hits: DuplicateHit[] = [];
  for (const job of jobs) {
    for (const task of job.tasks) {
      // Primary: exact match on the durable device/work identifier. This is the
      // authoritative signal and does not depend on any financial field.
      const ref = task.sourceWorkRef?.trim();
      let matched = false;
      if (ref && idSet.has(ref.toLowerCase())) {
        const dev = ids.find((d) => d.toLowerCase() === ref.toLowerCase())!;
        hits.push({ deviceId: dev, jobId: job.id, jobNumber: job.jobNumber, taskId: task.id, matchedBy: 'sourceWorkRef' });
        matched = true;
      }
      if (matched) continue;
      // Fallback (legacy): substring scan for tasks created before sourceWorkRef
      // existed. Never the primary path; billing code is not an identity.
      const hay = `${task.description ?? ''} ${task.billingCode ?? ''}`.toLowerCase();
      for (const dev of ids) {
        if (hay.includes(dev.toLowerCase())) {
          hits.push({ deviceId: dev, jobId: job.id, jobNumber: job.jobNumber, taskId: task.id, matchedBy: 'legacyText' });
        }
      }
    }
  }
  return hits;
}
