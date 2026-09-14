// Increment 10 — Workstream P/Q: mobile task status + production update.
// Server is authoritative: the device NEVER sends billing/payout rates. Amounts
// are always recomputed from the task's own stored rates.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyMobileSession } from '@/lib/mobile/auth';
import { detectConflict } from '@/lib/mobile/sync';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const ALLOWED = ['PENDING', 'IN_PROGRESS', 'SUBMITTED'] as const;
type Allowed = (typeof ALLOWED)[number];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await verifyMobileSession(req);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const ctx = v.ctx;

  const body = await req.json().catch(() => ({} as any));
  const status = body?.status as Allowed | undefined;
  const deviceTimestamp = (body?.deviceTimestamp as string | undefined) ?? null;
  const productionQuantity =
    body?.productionQuantity === undefined || body?.productionQuantity === null
      ? null
      : Number(body.productionQuantity);

  if (status && !ALLOWED.includes(status)) {
    return NextResponse.json({ error: `status must be one of ${ALLOWED.join(', ')}` }, { status: 400 });
  }
  if (productionQuantity !== null && (Number.isNaN(productionQuantity) || productionQuantity < 0)) {
    return NextResponse.json({ error: 'productionQuantity must be a non-negative number' }, { status: 400 });
  }

  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  // Authorization: field workers may only update tasks assigned to them.
  const isPrivileged = ctx.role === 'ADMIN' || ctx.role === 'PROJECT_MANAGER';
  if (!isPrivileged && task.workerId !== ctx.workerId) {
    return NextResponse.json({ error: 'Task is not assigned to you' }, { status: 403 });
  }

  // Last-write-wins conflict check against the server copy.
  const conflict = detectConflict((task as any).updatedAt ?? null, deviceTimestamp);

  const data: Record<string, any> = {};
  if (status) data.status = status;
  if (productionQuantity !== null) {
    const qty = productionQuantity;
    const billableAmount = Math.round(qty * task.billingRate);
    const costAmount = Math.round(qty * task.workerPayoutRate);
    data.quantity = qty;
    data.billableAmount = billableAmount;
    data.costAmount = costAmount;
    data.profitAmount = billableAmount - costAmount;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const updated = await prisma.task.update({ where: { id }, data });

  await writeAudit({
    actor: { id: ctx.userId, email: ctx.email, role: ctx.role },
    action: 'mobile.task_status',
    entityType: 'Task',
    entityId: id,
    metadata: { status: status ?? null, productionQuantity, conflict, deviceId: ctx.deviceId },
    ...requestMeta(req),
  });

  return NextResponse.json({
    task: {
      id: updated.id,
      status: updated.status,
      quantity: updated.quantity,
      billableAmount: updated.billableAmount,
      costAmount: updated.costAmount,
      profitAmount: updated.profitAmount,
    },
    conflict,
  });
}
