// /api/v1/payments — list (payments:read) and create (payments:write).
// Financial writes require authentication, authorization, rate limiting,
// request id and idempotency (Idempotency-Key header).
import { prisma } from '@/lib/prisma';
import { guard, ok, withIdempotency } from '@/lib/api-v1';
import { getProvider, toProviderConfig } from '@/lib/payments';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await guard(req, 'payments:read');
  if ('res' in g) return g.res;
  const payments = await prisma.payment.findMany({
    take: 100,
    orderBy: { createdAt: 'desc' },
    select: { id: true, invoiceId: true, amount: true, status: true, provider: true, environment: true, methodType: true, providerTransactionId: true, createdAt: true },
  });
  return ok(payments, g.requestId);
}

export async function POST(req: Request) {
  const g = await guard(req, 'payments:write');
  if ('res' in g) return g.res;
  const body = await req.json().catch(() => ({}));
  return withIdempotency(req, g.requestId, async () => {
    const settings = await prisma.paymentSettings.findUnique({ where: { id: 'default' } });
    if (!settings || !settings.enabled) return { status: 400, body: { error: 'Payments are not enabled.' } };
    if (!body.invoiceId) return { status: 400, body: { error: 'invoiceId is required.' } };
    const invoice = await prisma.invoice.findUnique({ where: { id: body.invoiceId } });
    if (!invoice) return { status: 404, body: { error: 'Invoice not found.' } };
    const amountCents = typeof body.amountCents === 'number' ? body.amountCents : invoice.total - invoice.amountPaid;
    const methodType = body.methodType === 'ACH' ? 'ACH' : 'CARD';
    const idempotencyKey: string = req.headers.get('idempotency-key') || `apiv1:invoice:${invoice.id}:${amountCents}`;
    const existing = await prisma.payment.findUnique({ where: { idempotencyKey } });
    if (existing) return { status: 200, body: { data: existing, idempotent: true } };
    const provider = getProvider(settings.provider);
    const result = await provider.sale(toProviderConfig(settings), {
      amountCents, methodType,
      cardNumber: body.cardNumber, cardExpMonth: body.cardExpMonth, cardExpYear: body.cardExpYear, cardCvv: body.cardCvv,
      routingNumber: body.routingNumber, accountNumber: body.accountNumber,
      orderId: invoice.invoiceNumber, requestId: g.requestId,
    });
    const payment = await prisma.payment.create({
      data: {
        invoiceId: invoice.id, primeContractorId: invoice.primeContractorId, amount: amountCents,
        status: result.status, provider: settings.provider, environment: settings.environment, methodType,
        providerTransactionId: result.providerTransactionId || null, providerReferenceId: result.providerReferenceId || null,
        actionCode: result.actionCode || null, responseText: result.responseText || null, cardLast4: result.cardLast4 || null,
        idempotencyKey, requestId: g.requestId, errorMessage: result.ok ? null : result.responseText || null,
      },
    });
    if (result.status === 'PAID') {
      const newPaid = invoice.amountPaid + amountCents;
      await prisma.invoice.update({ where: { id: invoice.id }, data: { amountPaid: newPaid, status: newPaid >= invoice.total ? 'PAID' : invoice.status } });
    }
    return { status: 201, body: { data: payment } };
  });
}
