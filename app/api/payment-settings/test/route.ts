// Workstream M — test IPPay connection (sandbox). ADMIN only.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getProvider, toProviderConfig } from '@/lib/payments';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const s = await prisma.paymentSettings.findUnique({ where: { id: 'default' } });
  if (!s) return NextResponse.json({ error: 'Payment settings not configured.' }, { status: 400 });
  const provider = getProvider(s.provider);
  const result = await provider.testConnection(toProviderConfig(s));
  const now = new Date();
  await prisma.paymentSettings.update({
    where: { id: 'default' },
    data: result.ok
      ? { lastSuccessAt: now, lastConnectionStatus: 'OK', lastFailureMessage: null }
      : { lastFailureAt: now, lastConnectionStatus: 'FAILED', lastFailureMessage: result.responseText || 'Connection failed.' },
  });
  const meta = requestMeta(req);
  await writeAudit({ actor: { id: session.user.id, email: session.user.email, role: session.user.role }, action: 'payment.test_connection', entityType: 'PaymentSettings', entityId: 'default', metadata: { ok: result.ok }, ...meta });
  // Never leak provider secrets/raw PAN; return only status fields.
  return NextResponse.json({ ok: result.ok, status: result.status, responseText: result.responseText, actionCode: result.actionCode });
}
