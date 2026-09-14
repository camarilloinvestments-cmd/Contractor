export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { canManage } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManage(session.user.role)) return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 });
  const { id } = await params;

  try {
    const body = await request.json();
    const { taskTypeId, description, quantity, billingRate, workerId, workerPayoutRate } = body ?? {};
    const qty = quantity ?? 0;
    const billAmt = Math.round(qty * (billingRate ?? 0));
    const costAmt = Math.round(qty * (workerPayoutRate ?? 0));

    const task = await prisma.task.create({
      data: {
        jobId: id,
        taskTypeId,
        description,
        quantity: qty,
        billingRate: billingRate ?? 0,
        workerPayoutRate: workerPayoutRate ?? 0,
        workerId: workerId || null,
        billableAmount: billAmt,
        costAmount: costAmt,
        profitAmount: billAmt - costAmt,
      },
    });
    return NextResponse.json(task);
  } catch (err: any) {
    console.error('Create task error:', err);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManage(session.user.role)) return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 });
  await params;

  try {
    const body = await request.json();
    // Explicit allow-list (mass-assignment protection, Section E). Snapshot/
    // financial fields (billableAmount, snapshots, jobId, invoiceItemId) are
    // NEVER client-writable; billable/cost/profit are recomputed below.
    const { taskId } = body ?? {};
    const data: any = {};
    if (body?.status !== undefined) data.status = body.status;
    if (body?.description !== undefined) data.description = body.description;
    if (body?.quantity !== undefined) data.quantity = body.quantity;
    if (body?.billingRate !== undefined) data.billingRate = body.billingRate;
    if (body?.workerPayoutRate !== undefined) data.workerPayoutRate = body.workerPayoutRate;
    if (body?.workerId !== undefined) data.workerId = body.workerId;

    if (data.quantity !== undefined || data.billingRate !== undefined || data.workerPayoutRate !== undefined) {
      const existing = await prisma.task.findUnique({ where: { id: taskId } });
      const qty = data.quantity ?? existing?.quantity ?? 0;
      const bill = data.billingRate ?? existing?.billingRate ?? 0;
      const cost = data.workerPayoutRate ?? existing?.workerPayoutRate ?? 0;
      data.billableAmount = Math.round(qty * bill);
      data.costAmount = Math.round(qty * cost);
      data.profitAmount = data.billableAmount - data.costAmount;
    }

    const task = await prisma.task.update({ where: { id: taskId }, data });
    return NextResponse.json(task);
  } catch (err: any) {
    console.error('Update task error:', err);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}
