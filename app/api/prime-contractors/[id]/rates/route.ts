export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const body = await request.json();
    const { taskTypeId, ratePerUnit } = body ?? {};
    const rate = await prisma.primeContractorRate.upsert({
      where: { primeContractorId_taskTypeId: { primeContractorId: id, taskTypeId } },
      create: { primeContractorId: id, taskTypeId, ratePerUnit },
      update: { ratePerUnit },
    });
    return NextResponse.json(rate);
  } catch (err: any) {
    console.error('Rate error:', err);
    return NextResponse.json({ error: 'Failed to save rate' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const { searchParams } = new URL(request.url);
    const taskTypeId = searchParams.get('taskTypeId');
    if (!taskTypeId) return NextResponse.json({ error: 'Missing taskTypeId' }, { status: 400 });
    await prisma.primeContractorRate.delete({
      where: { primeContractorId_taskTypeId: { primeContractorId: id, taskTypeId } },
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Delete rate error:', err);
    return NextResponse.json({ error: 'Failed to delete rate' }, { status: 500 });
  }
}
