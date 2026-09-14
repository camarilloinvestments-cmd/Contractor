export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { dollarsToCents } from '@/lib/utils/format';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const lines = await prisma.priceLine.findMany({ where: { priceBookId: id }, orderBy: { jobCode: 'asc' } });
  return NextResponse.json(lines);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const book = await prisma.priceBook.findUnique({ where: { id } });
    if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (book.status !== 'DRAFT') {
      return NextResponse.json({ error: 'Only draft books can be edited' }, { status: 400 });
    }
    const body = await req.json();
    const ratePerUnit = typeof body.ratePerUnit === 'number' ? body.ratePerUnit : dollarsToCents(parseFloat(body.rate));
    const line = await prisma.priceLine.upsert({
      where: { priceBookId_jobCode: { priceBookId: id, jobCode: body.jobCode } },
      create: {
        priceBookId: id, jobCode: body.jobCode, description: body.description ?? '',
        unit: body.unit ?? '', ratePerUnit, category: body.category ?? null, notes: body.notes ?? null,
      },
      update: {
        description: body.description ?? '', unit: body.unit ?? '', ratePerUnit,
        category: body.category ?? null, notes: body.notes ?? null,
      },
    });
    return NextResponse.json(line);
  } catch (err: any) {
    console.error('Add price line error:', err?.message);
    return NextResponse.json({ error: 'Failed to add line' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const { searchParams } = new URL(req.url);
    const lineId = searchParams.get('lineId');
    if (!lineId) return NextResponse.json({ error: 'Missing lineId' }, { status: 400 });
    const book = await prisma.priceBook.findUnique({ where: { id } });
    if (!book || book.status !== 'DRAFT') {
      return NextResponse.json({ error: 'Only draft books can be edited' }, { status: 400 });
    }
    await prisma.priceLine.delete({ where: { id: lineId } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Delete price line error:', err?.message);
    return NextResponse.json({ error: 'Failed to delete line' }, { status: 500 });
  }
}
