export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManage } from '@/lib/rbac';
import { writeAudit, requestMeta } from '@/lib/audit';
import { normalizeLines, computeTotals } from '@/lib/documents/compute';

const EDITABLE_STATUSES = new Set(['DRAFT']);

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const { id } = await params;
  const quote = await prisma.quote.findUnique({
    where: { id },
    include: {
      primeContractor: true,
      project: true,
      salesperson: true,
      items: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const sends = await prisma.documentSend.findMany({
    where: { documentType: 'QUOTE', documentId: id },
    orderBy: { createdAt: 'desc' },
  });
  const revisions = await prisma.documentRevision.findMany({
    where: { documentType: 'QUOTE', documentId: id },
    orderBy: { revision: 'desc' },
    select: { id: true, revision: true, createdAt: true, createdById: true },
  });
  return NextResponse.json({ quote, sends, revisions });
}

// PUT /api/quotes/[id] — edit while allowed (DRAFT only).
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const { user } = gate;
  const { id } = await params;

  const existing = await prisma.quote.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!EDITABLE_STATUSES.has(existing.status)) {
    return NextResponse.json(
      { error: `Quote cannot be edited in status ${existing.status}` },
      { status: 409 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const hasItems = Array.isArray(body?.items);
    const lines = hasItems ? normalizeLines(body.items) : null;
    const totals = lines
      ? computeTotals(lines, Number(body?.taxRate ?? existing.taxRate))
      : null;

    const quote = await prisma.$transaction(async (tx) => {
      if (lines) {
        await tx.quoteItem.deleteMany({ where: { quoteId: id } });
      }
      return tx.quote.update({
        where: { id },
        data: {
          title: body?.title ?? existing.title,
          projectId: body?.projectId === undefined ? existing.projectId : body.projectId || null,
          salespersonId:
            body?.salespersonId === undefined ? existing.salespersonId : body.salespersonId || null,
          issueDate: body?.issueDate ? new Date(body.issueDate) : existing.issueDate,
          expirationDate:
            body?.expirationDate === undefined
              ? existing.expirationDate
              : body.expirationDate
                ? new Date(body.expirationDate)
                : null,
          terms: body?.terms ?? existing.terms,
          exclusions: body?.exclusions ?? existing.exclusions,
          notes: body?.notes ?? existing.notes,
          ...(totals
            ? {
                subtotal: totals.subtotal,
                taxRate: totals.taxRate,
                taxAmount: totals.taxAmount,
                total: totals.total,
              }
            : {}),
          ...(lines ? { items: { create: lines } } : {}),
        },
        include: { items: true },
      });
    });

    await writeAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: 'quote.update',
      entityType: 'Quote',
      entityId: id,
      metadata: { quoteNumber: quote.quoteNumber },
      ...requestMeta(req),
    });

    return NextResponse.json({ quote });
  } catch (err: any) {
    console.error('Quote update error:', err?.message);
    return NextResponse.json({ error: 'Failed to update quote' }, { status: 500 });
  }
}
