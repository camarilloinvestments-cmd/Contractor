export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { createPriceBookVersion, type PriceLineInput } from '@/lib/price-books';
import { writeAudit, requestMeta } from '@/lib/audit';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

// List all versions of a price book (newest first) with line counts.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const versions = await prisma.priceBookVersion.findMany({
    where: { priceBookId: id },
    orderBy: { version: 'desc' },
    include: { _count: { select: { lines: true, jobs: true } } },
  });
  return NextResponse.json(versions);
}

// Create a NEW immutable version from supplied lines. Existing versions (and any
// work orders pinned to them) are never mutated.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const book = await prisma.priceBook.findUnique({ where: { id } });
    if (!book) return NextResponse.json({ error: 'Price book not found' }, { status: 404 });
    const body = await req.json();
    const lines: PriceLineInput[] = Array.isArray(body?.lines) ? body.lines : [];
    const version = await createPriceBookVersion(id, lines, {
      label: body.label ?? null,
      effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : null,
      expirationDate: body.expirationDate ? new Date(body.expirationDate) : null,
      notes: body.notes ?? null,
      createdById: session.user.id,
    });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'price_book_version.create', entityType: 'PriceBookVersion', entityId: version.id,
      metadata: { priceBookId: id, version: version.version, lines: lines.length },
      ...requestMeta(req),
    });
    return NextResponse.json(version);
  } catch (err: any) {
    console.error('Create price book version error:', err?.message);
    return NextResponse.json({ error: err?.message || 'Failed to create version' }, { status: 400 });
  }
}
