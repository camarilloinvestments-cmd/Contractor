export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';

const EARNED_EVENTS = ['JOB_COMPLETED', 'JOB_APPROVED', 'INVOICE_GENERATED', 'INVOICE_PAID'];

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const plan = await prisma.commissionPlan.findUnique({
    where: { id },
    include: { _count: { select: { jobs: true, commissionRecords: true } } },
  });
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(plan);
}

/**
 * PATCH supports editing plan metadata/config and archiving.
 * NOTE: historical CommissionRecords snapshot their own rate/plan at calc time,
 * so editing a plan never rewrites past commissions.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const body = await req.json();
    const data: any = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.earnedEvent !== undefined && EARNED_EVENTS.includes(body.earnedEvent)) data.earnedEvent = body.earnedEvent;
    if (body.config !== undefined) data.config = body.config ?? {};
    if (body.notes !== undefined) data.notes = body.notes ?? null;
    if (body.status !== undefined) data.status = body.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE';
    const plan = await prisma.commissionPlan.update({ where: { id }, data });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'commission_plan.update', entityType: 'CommissionPlan', entityId: plan.id,
      metadata: { fields: Object.keys(data) }, ...requestMeta(req),
    });
    return NextResponse.json(plan);
  } catch (err: any) {
    console.error('Update commission plan error:', err?.message);
    return NextResponse.json({ error: 'Failed to update commission plan' }, { status: 500 });
  }
}
