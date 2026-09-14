export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { createPriceBookVersion, activatePriceBookVersion, type PriceLineInput } from '@/lib/price-books';
import { writeAudit, requestMeta } from '@/lib/audit';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

// Approve a pending import: replace the target draft book's lines with the
// parsed valid rows. Only valid rows are applied; rows requiring correction are
// left out (available via the errors download).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const record = await prisma.priceImport.findUnique({ where: { id } });
    if (!record) return NextResponse.json({ error: 'Import not found' }, { status: 404 });
    if (record.status !== 'PENDING') {
      return NextResponse.json({ error: 'Import is not pending' }, { status: 400 });
    }
    if (!record.priceBookId) {
      return NextResponse.json({ error: 'Import has no target price book' }, { status: 400 });
    }
    const book = await prisma.priceBook.findUnique({ where: { id: record.priceBookId } });
    if (!book) return NextResponse.json({ error: 'Target price book not found' }, { status: 404 });
    if (book.status !== 'DRAFT') {
      return NextResponse.json({ error: 'Target price book is not a draft' }, { status: 400 });
    }
    const rows = (record.parsedRows as any as PriceLineInput[]) || [];
    // Immutable version model: approving an import creates a NEW price book
    // version from the parsed rows and activates it. Existing versions (and any
    // work orders pinned to them) are never mutated.
    const version = await createPriceBookVersion(record.priceBookId, rows, {
      createdById: session.user.id,
      notes: `Approved from price import ${id}`,
    });
    await activatePriceBookVersion(version.id);
    const updated = await prisma.priceImport.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: session.user.id,
        approvedAt: new Date(),
        priceBookVersionId: version.id,
      },
    });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'price_import.approve', entityType: 'PriceImport', entityId: id,
      metadata: { priceBookId: record.priceBookId, priceBookVersionId: version.id, version: version.version, lines: rows.length, usedAi: record.usedAi },
      ...requestMeta(req),
    });
    return NextResponse.json({ import: updated, applied: rows.length, versionId: version.id, version: version.version });
  } catch (err: any) {
    console.error('Approve import error:', err?.message);
    return NextResponse.json({ error: 'Failed to approve import' }, { status: 500 });
  }
}
