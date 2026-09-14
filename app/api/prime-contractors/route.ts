export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { canManage } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const contractors = await prisma.primeContractor.findMany({
    orderBy: { companyName: 'asc' },
    include: { _count: { select: { jobs: true, rateCards: true } } },
  });
  return NextResponse.json(contractors);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManage(session.user.role)) return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 });

  try {
    const body = await request.json();
    const contractor = await prisma.primeContractor.create({ data: body });
    return NextResponse.json(contractor);
  } catch (err: any) {
    console.error('Create contractor error:', err);
    return NextResponse.json({ error: 'Failed to create contractor' }, { status: 500 });
  }
}
