export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { canManage } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const invoices = await prisma.invoice.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      primeContractor: { select: { companyName: true, email: true } },
      _count: { select: { items: true } },
    },
  });
  return NextResponse.json(invoices);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManage(session.user.role)) return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 });

  try {
    const body = await request.json();
    const { primeContractorId, jobIds, taxRate = 0, notes } = body ?? {};

    // Get approved tasks for selected jobs
    const tasks = await prisma.task.findMany({
      where: {
        jobId: { in: jobIds ?? [] },
        status: 'APPROVED',
        invoiceItemId: null,
      },
      include: { taskType: true, job: { select: { jobName: true, jobNumber: true } } },
    });

    if ((tasks?.length ?? 0) === 0) {
      return NextResponse.json({ error: 'No approved tasks to invoice' }, { status: 400 });
    }

    // Workstream S: per-workflow closeout gate. If a job's pinned documentation
    // workflow version requires an approved closeout before invoicing, block
    // until an APPROVED CloseoutRevision exists for that job.
    const gateJobs = await prisma.job.findMany({
      where: { id: { in: jobIds ?? [] } },
      select: {
        id: true,
        jobNumber: true,
        documentationWorkflowVersion: { select: { requireCloseoutBeforeInvoice: true } },
        closeoutRevisions: { where: { status: 'APPROVED' }, select: { id: true }, take: 1 },
      },
    });
    const blocked = gateJobs.filter(
      (j) => j.documentationWorkflowVersion?.requireCloseoutBeforeInvoice && j.closeoutRevisions.length === 0
    );
    if (blocked.length > 0) {
      return NextResponse.json(
        {
          error: 'Closeout required before invoicing',
          jobs: blocked.map((j) => j.jobNumber),
        },
        { status: 409 }
      );
    }

    const count = await prisma.invoice.count();
    const invoiceNumber = `INV-${String(count + 1).padStart(4, '0')}`;

    // Group tasks by job
    const jobGroups: Record<string, any[]> = {};
    for (const task of (tasks ?? [])) {
      const jobKey = task?.jobId ?? 'unknown';
      if (!jobGroups[jobKey]) jobGroups[jobKey] = [];
      jobGroups[jobKey].push(task);
    }

    const items: any[] = [];
    let subtotal = 0;
    for (const [jobId, jobTasks] of Object.entries(jobGroups)) {
      const firstTask = jobTasks?.[0];
      for (const task of (jobTasks ?? [])) {
        const amount = task?.billableAmount ?? 0;
        subtotal += amount;
        items.push({
          description: `${firstTask?.job?.jobNumber ?? ''} - ${firstTask?.job?.jobName ?? ''}: ${task?.taskType?.name ?? ''} (${task?.quantity ?? 0} ${task?.taskType?.unitOfMeasure ?? ''})`,
          quantity: task?.quantity ?? 0,
          unitPrice: task?.billingRate ?? 0,
          amount,
          jobId,
          taskIds: [task?.id],
        });
      }
    }

    const taxAmount = Math.round(subtotal * (taxRate / 100));
    const total = subtotal + taxAmount;

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        primeContractorId,
        subtotal,
        taxRate,
        taxAmount,
        total,
        notes,
        items: {
          create: items.map((item: any) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.amount,
            jobId: item.jobId,
          })),
        },
      },
      include: { items: true },
    });

    // Link tasks to invoice items
    for (let i = 0; i < (items?.length ?? 0); i++) {
      const item = items[i];
      const createdItem = invoice?.items?.[i];
      if (createdItem && item?.taskIds) {
        for (const taskId of item.taskIds) {
          await prisma.task.update({
            where: { id: taskId },
            data: { invoiceItemId: createdItem.id },
          });
        }
      }
    }

    // Mark jobs as invoiced
    for (const jobId of (jobIds ?? [])) {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'INVOICED' } });
    }

    return NextResponse.json(invoice);
  } catch (err: any) {
    console.error('Create invoice error:', err);
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }
}
