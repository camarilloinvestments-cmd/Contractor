export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { addInHouseRate, listInHouseRates } from '@/lib/price-books';
import { dollarsToCents } from '@/lib/utils/format';
import { writeAudit, requestMeta } from '@/lib/audit';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rates = await listInHouseRates();
  return NextResponse.json(rates);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json();
    if (!body?.jobCode) return NextResponse.json({ error: 'jobCode is required' }, { status: 400 });
    const ratePerUnit = typeof body.ratePerUnit === 'number' ? body.ratePerUnit : dollarsToCents(parseFloat(body.rate));
    const rate = await addInHouseRate({
      jobCode: body.jobCode, description: body.description ?? null, unit: body.unit ?? null,
      ratePerUnit, notes: body.notes ?? null,
      effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : null,
      createdById: session.user.id,
    });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'inhouse_rate.add', entityType: 'InHouseRate', entityId: rate.id,
      metadata: { jobCode: body.jobCode, version: rate.version }, ...requestMeta(req),
    });
    return NextResponse.json(rate);
  } catch (err: any) {
    console.error('Add in-house rate error:', err?.message);
    return NextResponse.json({ error: 'Failed to add rate' }, { status: 500 });
  }
}
