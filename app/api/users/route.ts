export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { writeAudit, requestMeta } from '@/lib/audit';

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, email: true, name: true, role: true, status: true,
      forcePasswordChange: true, workerId: true, createdAt: true,
      deactivatedAt: true, lastLoginAt: true,
    },
  });
  return NextResponse.json(users);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { email, password, name, role, workerId } = body ?? {};
    if (!email || !password || !name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return NextResponse.json({ error: 'Email already in use' }, { status: 400 });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, name, passwordHash, role: role ?? 'FIELD_WORKER', workerId: workerId || null },
    });

    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'user.create',
      entityType: 'User',
      entityId: user.id,
      metadata: { email: user.email, role: user.role },
      ...requestMeta(request),
    });

    return NextResponse.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  } catch (err: any) {
    console.error('Create user error:', err);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
