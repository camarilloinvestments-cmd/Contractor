export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { canManage } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workers = await prisma.worker.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { tasks: true } },
      user: { select: { id: true, email: true } },
    },
  });
  return NextResponse.json(workers);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManage(session.user.role)) return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 });

  try {
    const body = await request.json();
    const worker = await prisma.worker.create({ data: body });
    return NextResponse.json(worker);
  } catch (err: any) {
    console.error('Create worker error:', err);
    return NextResponse.json({ error: 'Failed to create worker' }, { status: 500 });
  }
}
