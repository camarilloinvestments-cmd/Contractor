export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireManage } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { createWithNumber } from '@/lib/documents/numbering';
import { writeAudit, requestMeta } from '@/lib/audit';

// Convert an Estimate into a NEW Quote. The Estimate is PRESERVED as history
// (never mutated into a quote) — only its status is marked CONVERTED and it is
// linked to the new quote (requirement B). All commercial line values are copied
// into brand-new QuoteItem rows.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const { user } = gate;
  const { id } = await params;

  try {
    const estimate = await prisma.estimate.findUnique({
      where: { id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!estimate) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (estimate.convertedToQuoteId) {
      return NextResponse.json(
        { error: 'Estimate has already been converted to a quote', quoteId: estimate.convertedToQuoteId },
        { status: 409 }
      );
    }
    if (estimate.status === 'CANCELLED' || estimate.status === 'DECLINED') {
      return NextResponse.json(
        { error: `Cannot convert an estimate in status ${estimate.status}` },
        { status: 409 }
      );
    }

    const quote = await prisma.$transaction(async (tx) => {
      const created = await createWithNumber(
        'QUOTE',
        (quoteNumber) =>
          tx.quote.create({
            data: {
              quoteNumber,
              primeContractorId: estimate.primeContractorId,
              projectId: estimate.projectId,
              sourceEstimateId: estimate.id,
              title: estimate.title,
              issueDate: new Date(),
              expirationDate: estimate.expirationDate,
              subtotal: estimate.subtotal,
              taxRate: estimate.taxRate,
              taxAmount: estimate.taxAmount,
              total: estimate.total,
              exclusions: estimate.exclusions,
              createdById: user.id,
              items: {
                create: estimate.items.map((it) => ({
                  description: it.description,
                  quantity: it.quantity,
                  unit: it.unit,
                  unitPrice: it.unitPrice,
                  amount: it.amount,
                  jobCode: it.jobCode,
                  priceBookId: it.priceBookId,
                  priceBookVersionId: it.priceBookVersionId,
                  sortOrder: it.sortOrder,
                })),
              },
            },
            include: { items: true },
          }),
        5,
      );

      // Preserve the estimate as history: mark CONVERTED + link, do NOT mutate lines.
      await tx.estimate.update({
        where: { id: estimate.id },
        data: { status: 'CONVERTED', convertedToQuoteId: created.id },
      });
      return created;
    });

    await writeAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: 'estimate.convert',
      entityType: 'Estimate',
      entityId: estimate.id,
      metadata: { estimateNumber: estimate.estimateNumber, quoteId: quote.id, quoteNumber: quote.quoteNumber },
      ...requestMeta(req),
    });

    return NextResponse.json({ ok: true, quote }, { status: 201 });
  } catch (err: any) {
    console.error('Estimate convert error:', err?.message);
    return NextResponse.json({ ok: false, error: 'Failed to convert estimate' }, { status: 500 });
  }
}
