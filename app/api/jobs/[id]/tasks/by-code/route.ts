export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { addBillingCodeToTask } from '@/lib/work-orders';
import { writeAudit, requestMeta } from '@/lib/audit';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

// Add an opaque billing code to a work order as a Task. The line is resolved
// ONLY from the WO's pinned price book version and snapshotted onto the task.
// Prime billing and worker payout are independent (payout never derived from
// the prime rate).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const body = await req.json();
    if (!body?.taskTypeId || !body?.jobCode) {
      return NextResponse.json({ error: 'taskTypeId and jobCode are required' }, { status: 400 });
    }
    const task = await addBillingCodeToTask({
      jobId: id,
      taskTypeId: body.taskTypeId,
      jobCode: body.jobCode,
      quantity: typeof body.quantity === 'number' ? body.quantity : Number(body.quantity) || 0,
      workerId: body.workerId ?? null,
      workerPayoutRate: typeof body.workerPayoutRate === 'number' ? body.workerPayoutRate : undefined,
      description: body.description ?? null,
    });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'task.add_billing_code', entityType: 'Task', entityId: task.id,
      metadata: { jobId: id, billingCode: task.billingCode, priceBookVersionId: task.priceBookVersionId },
      ...requestMeta(req),
    });
    return NextResponse.json(task);
  } catch (err: any) {
    console.error('Add billing code to task error:', err?.message);
    return NextResponse.json({ error: err?.message || 'Failed to add billing code' }, { status: 400 });
  }
}
