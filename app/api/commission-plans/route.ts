export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';

const PLAN_TYPES = ['PERCENT_REVENUE', 'PERCENT_GROSS_PROFIT', 'FLAT_PER_JOB', 'FLAT_PER_TASK', 'PRODUCTION_RATE', 'TIERED'];
const EARNED_EVENTS = ['JOB_COMPLETED', 'JOB_APPROVED', 'INVOICE_GENERATED', 'INVOICE_PAID'];

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || undefined;
  const plans = await prisma.commissionPlan.findMany({
    where: status ? { status: status as any } : undefined,
    include: { _count: { select: { jobs: true, commissionRecords: true } } },
    orderBy: [{ status: 'asc' }, { name: 'asc' }, { version: 'desc' }],
  });
  return NextResponse.json(plans);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json();
    if (!body?.name || !String(body.name).trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (!PLAN_TYPES.includes(body.planType)) {
      return NextResponse.json({ error: 'Invalid plan type' }, { status: 400 });
    }
    const earnedEvent = EARNED_EVENTS.includes(body.earnedEvent) ? body.earnedEvent : 'INVOICE_PAID';
    const plan = await prisma.commissionPlan.create({
      data: {
        name: String(body.name).trim(),
        planType: body.planType,
        earnedEvent,
        config: body.config ?? {},
        notes: body.notes ?? null,
        status: 'ACTIVE',
        version: 1,
        createdById: session.user.id,
      },
    });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'commission_plan.create', entityType: 'CommissionPlan', entityId: plan.id,
      metadata: { name: plan.name, planType: plan.planType }, ...requestMeta(req),
    });
    return NextResponse.json(plan);
  } catch (err: any) {
    console.error('Create commission plan error:', err?.message);
    return NextResponse.json({ error: 'Failed to create commission plan' }, { status: 500 });
  }
}
