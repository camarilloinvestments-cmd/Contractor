export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { listPriceBooks, createPriceBook, clonePriceBook } from '@/lib/price-books';
import { writeAudit, requestMeta } from '@/lib/audit';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const primeId = searchParams.get('primeId');
  if (!primeId) return NextResponse.json({ error: 'Missing primeId' }, { status: 400 });
  const books = await listPriceBooks(primeId);
  return NextResponse.json(books);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json();
    // Clone path
    if (body?.cloneFromId) {
      const cloned = await clonePriceBook(body.cloneFromId, {
        primeContractorId: body.primeContractorId || undefined,
        name: body.name || undefined,
        createdById: session.user.id,
      });
      await writeAudit({
        actor: { id: session.user.id, email: session.user.email, role: session.user.role },
        action: 'price_book.clone', entityType: 'PriceBook', entityId: cloned.id,
        metadata: { source: body.cloneFromId, name: cloned.name, version: cloned.version },
        ...requestMeta(req),
      });
      return NextResponse.json(cloned);
    }
    if (!body?.primeContractorId || !body?.name) {
      return NextResponse.json({ error: 'primeContractorId and name are required' }, { status: 400 });
    }
    const book = await createPriceBook({
      primeContractorId: body.primeContractorId,
      name: body.name,
      contract: body.contract ?? null,
      projectId: body.projectId ?? null,
      projectLabel: body.projectLabel ?? body.project ?? null,
      market: body.market ?? null,
      region: body.region ?? null,
      effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : null,
      expirationDate: body.expirationDate ? new Date(body.expirationDate) : null,
      notes: body.notes ?? null,
      createdById: session.user.id,
    });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'price_book.create', entityType: 'PriceBook', entityId: book.id,
      metadata: { name: book.name, version: book.version, prime: book.primeContractorId },
      ...requestMeta(req),
    });
    return NextResponse.json(book);
  } catch (err: any) {
    console.error('Create price book error:', err?.message);
    return NextResponse.json({ error: 'Failed to create price book' }, { status: 500 });
  }
}
