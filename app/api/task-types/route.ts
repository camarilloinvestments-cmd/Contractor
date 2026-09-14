export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { canManage } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const types = await prisma.taskType.findMany({ orderBy: { name: 'asc' } });
  return NextResponse.json(types);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManage(session.user.role)) return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 });

  try {
    const body = await request.json();
    const taskType = await prisma.taskType.create({ data: body });
    return NextResponse.json(taskType);
  } catch (err: any) {
    console.error('Create task type error:', err);
    return NextResponse.json({ error: 'Failed to create task type' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManage(session.user.role)) return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 });

  try {
    const body = await request.json();
    const { id, ...data } = body ?? {};
    const updated = await prisma.taskType.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (err: any) {
    console.error('Update task type error:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
