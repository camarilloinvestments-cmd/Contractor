// GET /api/v1/invoices — list invoices (scope: invoices:read).
import { prisma } from '@/lib/prisma';
import { guard, ok } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await guard(req, 'invoices:read');
  if ('res' in g) return g.res;
  const invoices = await prisma.invoice.findMany({
    take: 100,
    orderBy: { createdAt: 'desc' },
    select: { id: true, invoiceNumber: true, status: true, total: true, amountPaid: true, primeContractorId: true, createdAt: true },
  });
  return ok(invoices, g.requestId);
}
