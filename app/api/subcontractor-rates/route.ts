export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { addSubcontractorRate, listSubcontractorRates } from '@/lib/price-books';
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
  const { searchParams } = new URL(req.url);
  const workerId = searchParams.get('workerId') || undefined;
  const rates = await listSubcontractorRates(workerId);
  return NextResponse.json(rates);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json();
    if (!body?.workerId || !body?.jobCode) {
      return NextResponse.json({ error: 'workerId and jobCode are required' }, { status: 400 });
    }
    const ratePerUnit = typeof body.ratePerUnit === 'number' ? body.ratePerUnit : dollarsToCents(parseFloat(body.rate));
    const rate = await addSubcontractorRate({
      workerId: body.workerId, jobCode: body.jobCode, description: body.description ?? null,
      unit: body.unit ?? null, ratePerUnit, notes: body.notes ?? null,
      effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : null,
      createdById: session.user.id,
    });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'subcontractor_rate.add', entityType: 'SubcontractorRate', entityId: rate.id,
      metadata: { workerId: body.workerId, jobCode: body.jobCode, version: rate.version }, ...requestMeta(req),
    });
    return NextResponse.json(rate);
  } catch (err: any) {
    console.error('Add subcontractor rate error:', err?.message);
    return NextResponse.json({ error: 'Failed to add rate' }, { status: 500 });
  }
}
