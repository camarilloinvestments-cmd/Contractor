export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getPriceBook, activatePriceBook, archivePriceBook } from '@/lib/price-books';
import { writeAudit, requestMeta } from '@/lib/audit';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const book = await getPriceBook(id);
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(book);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const body = await req.json();
    if (body?.status === 'ACTIVE') {
      const updated = await activatePriceBook(id);
      await writeAudit({
        actor: { id: session.user.id, email: session.user.email, role: session.user.role },
        action: 'price_book.activate', entityType: 'PriceBook', entityId: id,
        metadata: { name: updated.name, version: updated.version }, ...requestMeta(req),
      });
      return NextResponse.json(updated);
    }
    if (body?.status === 'ARCHIVED') {
      const updated = await archivePriceBook(id);
      await writeAudit({
        actor: { id: session.user.id, email: session.user.email, role: session.user.role },
        action: 'price_book.archive', entityType: 'PriceBook', entityId: id, ...requestMeta(req),
      });
      return NextResponse.json(updated);
    }
    // Metadata edits (only allowed while DRAFT)
    const existing = await prisma.priceBook.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (existing.status !== 'DRAFT') {
      return NextResponse.json({ error: 'Only draft books can be edited' }, { status: 400 });
    }
    const data: Record<string, unknown> = {};
    for (const k of ['name', 'contract', 'project', 'market', 'region', 'notes']) {
      if (k in body) data[k] = body[k];
    }
    if ('effectiveDate' in body) data.effectiveDate = body.effectiveDate ? new Date(body.effectiveDate) : null;
    if ('expirationDate' in body) data.expirationDate = body.expirationDate ? new Date(body.expirationDate) : null;
    const updated = await prisma.priceBook.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (err: any) {
    console.error('Update price book error:', err?.message);
    return NextResponse.json({ error: 'Failed to update price book' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const existing = await prisma.priceBook.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (existing.status !== 'DRAFT') {
      return NextResponse.json({ error: 'Only draft books can be deleted' }, { status: 400 });
    }
    await prisma.priceBook.delete({ where: { id } });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'price_book.delete', entityType: 'PriceBook', entityId: id, ...requestMeta(req),
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Delete price book error:', err?.message);
    return NextResponse.json({ error: 'Failed to delete price book' }, { status: 500 });
  }
}
