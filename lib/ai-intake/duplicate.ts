// Duplicate detection performed BEFORE any work order is created.
//
// Flags a proposed device as a POSSIBLE DUPLICATE when an open work order for
// the same prime/project already contains a task whose billing code or
// description references the same device id. Detection only RAISES a review
// flag; it never blocks or auto-merges — the operator decides.
import { prisma } from '@/lib/prisma';

export type DuplicateHit = { deviceId: string; jobId: string; jobNumber: string; taskId: string };

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
      tasks: { select: { id: true, description: true, billingCode: true } },
    },
  });

  const hits: DuplicateHit[] = [];
  for (const job of jobs) {
    for (const task of job.tasks) {
      const hay = `${task.description ?? ''} ${task.billingCode ?? ''}`.toLowerCase();
      for (const dev of ids) {
        if (hay.includes(dev.toLowerCase())) {
          hits.push({ deviceId: dev, jobId: job.id, jobNumber: job.jobNumber, taskId: task.id });
        }
      }
    }
  }
  return hits;
}
