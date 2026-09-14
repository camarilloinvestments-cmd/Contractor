export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireManage } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';

const REJECTABLE = new Set(['SENT', 'VIEWED', 'DRAFT']);

// POST /api/quotes/[id]/reject — record customer rejection.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const { user } = gate;
  const { id } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const existing = await prisma.quote.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!REJECTABLE.has(existing.status)) {
      return NextResponse.json(
        { error: `Quote cannot be rejected in status ${existing.status}` },
        { status: 409 }
      );
    }

    const quote = await prisma.quote.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectedAt: new Date(),
        rejectionReason: body?.rejectionReason || null,
      },
    });

    await writeAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: 'quote.reject',
      entityType: 'Quote',
      entityId: id,
      metadata: { quoteNumber: quote.quoteNumber, rejectionReason: quote.rejectionReason },
      ...requestMeta(req),
    });

    return NextResponse.json({ ok: true, quote });
  } catch (err: any) {
    console.error('Quote reject error:', err?.message);
    return NextResponse.json({ ok: false, error: 'Failed to reject quote' }, { status: 500 });
  }
}
