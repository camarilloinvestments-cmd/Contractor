// Workstream M — PAY NOW for an invoice (sandbox, idempotent). ADMIN/PM.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getProvider, toProviderConfig } from '@/lib/payments';
import { writeAudit, requestMeta } from '@/lib/audit';
import { newRequestId } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const canManage = session.user.role === 'ADMIN' || session.user.role === 'PROJECT_MANAGER';
  if (!canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const requestId = newRequestId();

  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  const settings = await prisma.paymentSettings.findUnique({ where: { id: 'default' } });
  if (!settings || !settings.enabled) {
    return NextResponse.json({ error: 'Payments are not enabled.' }, { status: 400 });
  }

  // Idempotency: reuse the caller-supplied key or derive a stable one.
  const idempotencyKey: string = body.idempotencyKey || `invoice:${id}:${invoice.total}`;
  const existing = await prisma.payment.findUnique({ where: { idempotencyKey } });
  if (existing) {
    return NextResponse.json({ payment: existing, idempotent: true });
  }

  const amountCents = typeof body.amountCents === 'number' ? body.amountCents : invoice.total - invoice.amountPaid;
  const methodType = body.methodType === 'ACH' ? 'ACH' : 'CARD';

  const provider = getProvider(settings.provider);
  const result = await provider.sale(toProviderConfig(settings), {
    amountCents,
    methodType,
    cardNumber: body.cardNumber,
    cardExpMonth: body.cardExpMonth,
    cardExpYear: body.cardExpYear,
    cardCvv: body.cardCvv,
    routingNumber: body.routingNumber,
    accountNumber: body.accountNumber,
    orderId: invoice.invoiceNumber,
    requestId,
  });

  const payment = await prisma.payment.create({
    data: {
      invoiceId: invoice.id,
      primeContractorId: invoice.primeContractorId,
      amount: amountCents,
      status: result.status,
      provider: settings.provider,
      environment: settings.environment,
      methodType,
      providerTransactionId: result.providerTransactionId || null,
      providerReferenceId: result.providerReferenceId || null,
      actionCode: result.actionCode || null,
      responseText: result.responseText || null,
      cardLast4: result.cardLast4 || null,
      idempotencyKey,
      requestId,
      errorMessage: result.ok ? null : result.responseText || null,
      createdById: session.user.id,
    },
  });

  if (result.status === 'PAID') {
    const newPaid = invoice.amountPaid + amountCents;
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { amountPaid: newPaid, status: newPaid >= invoice.total ? 'PAID' : invoice.status },
    });
  }

  const meta = requestMeta(req);
  await writeAudit({ actor: { id: session.user.id, email: session.user.email, role: session.user.role }, action: 'invoice.payment', entityType: 'Invoice', entityId: invoice.id, metadata: { status: result.status, requestId }, ...meta });

  return NextResponse.json({ payment, requestId });
}
