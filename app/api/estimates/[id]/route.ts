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
  const estimate = await prisma.estimate.findUnique({
    where: { id },
    include: {
      primeContractor: true,
      project: true,
      items: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!estimate) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const sends = await prisma.documentSend.findMany({
    where: { documentType: 'ESTIMATE', documentId: id },
    orderBy: { createdAt: 'desc' },
  });
  const revisions = await prisma.documentRevision.findMany({
    where: { documentType: 'ESTIMATE', documentId: id },
    orderBy: { revision: 'desc' },
    select: { id: true, revision: true, createdAt: true, createdById: true },
  });
  return NextResponse.json({ estimate, sends, revisions });
}

// PUT /api/estimates/[id] — edit while allowed (DRAFT only).
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const { user } = gate;
  const { id } = await params;

  const existing = await prisma.estimate.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!EDITABLE_STATUSES.has(existing.status)) {
    return NextResponse.json(
      { error: `Estimate cannot be edited in status ${existing.status}` },
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

    const estimate = await prisma.$transaction(async (tx) => {
      if (lines) {
        await tx.estimateItem.deleteMany({ where: { estimateId: id } });
      }
      return tx.estimate.update({
        where: { id },
        data: {
          title: body?.title ?? existing.title,
          projectId: body?.projectId === undefined ? existing.projectId : body.projectId || null,
          issueDate: body?.issueDate ? new Date(body.issueDate) : existing.issueDate,
          expirationDate:
            body?.expirationDate === undefined
              ? existing.expirationDate
              : body.expirationDate
                ? new Date(body.expirationDate)
                : null,
          assumptions: body?.assumptions ?? existing.assumptions,
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
      action: 'estimate.update',
      entityType: 'Estimate',
      entityId: id,
      metadata: { estimateNumber: estimate.estimateNumber },
      ...requestMeta(req),
    });

    return NextResponse.json({ estimate });
  } catch (err: any) {
    console.error('Estimate update error:', err?.message);
    return NextResponse.json({ error: 'Failed to update estimate' }, { status: 500 });
  }
}
