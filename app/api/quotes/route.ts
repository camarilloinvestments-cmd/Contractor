export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManage } from '@/lib/rbac';
import { writeAudit, requestMeta } from '@/lib/audit';
import { createWithNumber } from '@/lib/documents/numbering';
import { normalizeLines, computeTotals } from '@/lib/documents/compute';

// GET /api/quotes — list quotes (managers/admins).
export async function GET() {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const quotes = await prisma.quote.findMany({
    include: {
      primeContractor: { select: { id: true, companyName: true, contactName: true } },
      project: { select: { id: true, projectName: true, projectCode: true } },
      salesperson: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ quotes });
}

// POST /api/quotes — create a new quote with an independent Q number.
export async function POST(req: Request) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const { user } = gate;

  try {
    const body = await req.json().catch(() => ({}));
    const primeContractorId = body?.primeContractorId as string | undefined;
    if (!primeContractorId) {
      return NextResponse.json({ error: 'primeContractorId is required' }, { status: 400 });
    }
    const prime = await prisma.primeContractor.findUnique({ where: { id: primeContractorId } });
    if (!prime) return NextResponse.json({ error: 'Prime contractor not found' }, { status: 404 });

    const lines = normalizeLines(body?.items);
    const totals = computeTotals(lines, Number(body?.taxRate ?? 0));

    const quote = await createWithNumber('QUOTE', (quoteNumber) =>
      prisma.quote.create({
        data: {
          quoteNumber,
          primeContractorId,
          projectId: body?.projectId || null,
          salespersonId: body?.salespersonId || null,
          title: body?.title || null,
          issueDate: body?.issueDate ? new Date(body.issueDate) : new Date(),
          expirationDate: body?.expirationDate ? new Date(body.expirationDate) : null,
          terms: body?.terms || null,
          exclusions: body?.exclusions || null,
          notes: body?.notes || null,
          subtotal: totals.subtotal,
          taxRate: totals.taxRate,
          taxAmount: totals.taxAmount,
          total: totals.total,
          createdById: user.id,
          items: { create: lines },
        },
        include: { items: true },
      })
    );

    await writeAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: 'quote.create',
      entityType: 'Quote',
      entityId: quote.id,
      metadata: { quoteNumber: quote.quoteNumber, total: quote.total },
      ...requestMeta(req),
    });

    return NextResponse.json({ quote }, { status: 201 });
  } catch (err: any) {
    console.error('Quote create error:', err?.message);
    return NextResponse.json({ error: 'Failed to create quote' }, { status: 500 });
  }
}
