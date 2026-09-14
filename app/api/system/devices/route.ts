// Increment 10 — Workstream P: admin device inventory (mobile device management).
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const devices = await prisma.mobileDevice.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 500,
    include: {
      worker: { select: { id: true, name: true, companyName: true } },
      user: { select: { id: true, email: true, name: true } },
      sessions: {
        where: { revokedAt: null },
        select: { id: true, createdAt: true, expiresAt: true, lastUsedAt: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  return NextResponse.json({ devices });
}
