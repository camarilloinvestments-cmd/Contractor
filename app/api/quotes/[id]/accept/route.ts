export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireManage } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';

const ACCEPTABLE = new Set(['SENT', 'VIEWED', 'DRAFT']);

// POST /api/quotes/[id]/accept — record customer acceptance metadata.
// At acceptance we PIN the price book / version provenance onto the quote so a
// later price-book upload can never alter the accepted commercial terms.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const { user } = gate;
  const { id } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const existing = await prisma.quote.findUnique({
      where: { id },
      include: { items: { select: { priceBookId: true, priceBookVersionId: true } } },
    });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (existing.status === 'ACCEPTED') {
      return NextResponse.json({ error: 'Quote is already accepted' }, { status: 409 });
    }
    if (!ACCEPTABLE.has(existing.status)) {
      return NextResponse.json(
        { error: `Quote cannot be accepted in status ${existing.status}` },
        { status: 409 }
      );
    }

    // Derive pinned provenance from the line snapshots (first line that carries it).
    const pinnedItem = existing.items.find((i) => i.priceBookVersionId);

    const quote = await prisma.quote.update({
      where: { id },
      data: {
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        acceptedByName: body?.acceptedByName || null,
        acceptedByEmail: body?.acceptedByEmail || null,
        acceptanceNote: body?.acceptanceNote || null,
        priceBookId: existing.priceBookId ?? pinnedItem?.priceBookId ?? null,
        priceBookVersionId: existing.priceBookVersionId ?? pinnedItem?.priceBookVersionId ?? null,
      },
    });

    await writeAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: 'quote.accept',
      entityType: 'Quote',
      entityId: id,
      metadata: {
        quoteNumber: quote.quoteNumber,
        acceptedByName: quote.acceptedByName,
        acceptedByEmail: quote.acceptedByEmail,
      },
      ...requestMeta(req),
    });

    return NextResponse.json({ ok: true, quote });
  } catch (err: any) {
    console.error('Quote accept error:', err?.message);
    return NextResponse.json({ ok: false, error: 'Failed to accept quote' }, { status: 500 });
  }
}
