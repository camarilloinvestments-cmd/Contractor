export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { activatePriceBookVersion } from '@/lib/price-books';
import { writeAudit, requestMeta } from '@/lib/audit';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

// Get a single version with its lines (historical evidence, read-only).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const version = await prisma.priceBookVersion.findUnique({
    where: { id },
    include: { lines: { orderBy: { jobCode: 'asc' } }, priceBook: { select: { id: true, name: true, primeContractorId: true } } },
  });
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(version);
}

// Activate a version (archives any other ACTIVE version of the same book). Older
// versions keep their lines intact for work orders pinned to them.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const body = await req.json();
    if (body?.status === 'ACTIVE') {
      const updated = await activatePriceBookVersion(id);
      await writeAudit({
        actor: { id: session.user.id, email: session.user.email, role: session.user.role },
        action: 'price_book_version.activate', entityType: 'PriceBookVersion', entityId: id,
        metadata: { version: updated.version, priceBookId: updated.priceBookId }, ...requestMeta(req),
      });
      return NextResponse.json(updated);
    }
    return NextResponse.json({ error: 'Unsupported update' }, { status: 400 });
  } catch (err: any) {
    console.error('Update price book version error:', err?.message);
    return NextResponse.json({ error: err?.message || 'Failed to update version' }, { status: 400 });
  }
}
