export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      primeContractor: true,
      items: { include: { tasks: { include: { taskType: true } } } },
    },
  });
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(invoice);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const body = await request.json();
    const updated = await prisma.invoice.update({ where: { id }, data: body });
    return NextResponse.json(updated);
  } catch (err: any) {
    console.error('Update invoice error:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
