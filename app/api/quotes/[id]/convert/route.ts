export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireManage } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { createWithNumber } from '@/lib/documents/numbering';
import { buildQuoteSnapshot, createRevision } from '@/lib/documents/snapshots';
import { writeAudit, requestMeta } from '@/lib/audit';

// Convert an ACCEPTED Quote into a NEW Work Order (Job). The Quote is PRESERVED
// as history (never mutated) — only its status is marked CONVERTED and it is
// linked to the new job. The commercial terms are pinned by COPYING the quote's
// own priceBookId / priceBookVersionId onto the WO (requirement D): the newer
// price book is NEVER re-queried. The full accepted-quote line snapshot is
// preserved as an immutable DocumentRevision attached to the WO.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const { user } = gate;
  const { id } = await params;

  try {
    const quote = await prisma.quote.findUnique({
      where: { id },
      include: { primeContractor: true, project: true, salesperson: true, items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (quote.convertedToJobId) {
      return NextResponse.json(
        { error: 'Quote has already been converted to a work order', jobId: quote.convertedToJobId },
        { status: 409 }
      );
    }
    if (quote.status !== 'ACCEPTED') {
      return NextResponse.json(
        { error: `Only an ACCEPTED quote can be converted to a work order (status is ${quote.status})` },
        { status: 409 }
      );
    }
    if (!quote.projectId) {
      return NextResponse.json(
        { error: 'Quote has no project; a work order requires a project' },
        { status: 400 }
      );
    }

    // Pin provenance directly from the quote (never re-query a newer book).
    const pinnedItem = quote.items.find((i) => i.priceBookVersionId);
    const priceBookId = quote.priceBookId ?? pinnedItem?.priceBookId ?? null;
    const priceBookVersionId = quote.priceBookVersionId ?? pinnedItem?.priceBookVersionId ?? null;

    const job = await prisma.$transaction(async (tx) => {
      const created = await createWithNumber(
        'WORKORDER',
        (jobNumber) =>
          tx.job.create({
            data: {
              jobNumber,
              jobName: quote.title || `Work Order from ${quote.quoteNumber}`,
              primeContractorId: quote.primeContractorId,
              projectId: quote.projectId,
              priceBookId,
              priceBookVersionId,
              salespersonId: quote.salespersonId,
              sourceQuoteId: quote.id,
              status: 'DRAFT',
            },
          }),
        5,
      );

      // Immutable snapshot of the accepted quote, attached to the WO for history.
      await createRevision('QUOTE', quote.id, buildQuoteSnapshot(quote), user.id, tx);

      // Preserve the quote as history: mark CONVERTED + link, do NOT mutate lines.
      await tx.quote.update({
        where: { id: quote.id },
        data: { status: 'CONVERTED', convertedToJobId: created.id },
      });
      return created;
    });

    await writeAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: 'quote.convert',
      entityType: 'Quote',
      entityId: quote.id,
      metadata: {
        quoteNumber: quote.quoteNumber,
        jobId: job.id,
        jobNumber: job.jobNumber,
        priceBookVersionId,
      },
      ...requestMeta(req),
    });

    return NextResponse.json({ ok: true, job }, { status: 201 });
  } catch (err: any) {
    console.error('Quote convert error:', err?.message);
    return NextResponse.json({ ok: false, error: 'Failed to convert quote' }, { status: 500 });
  }
}
