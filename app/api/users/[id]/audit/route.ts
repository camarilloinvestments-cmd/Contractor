export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

// GET /api/users/:id/audit -> recent audit history for this user (admin only).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const logs = await prisma.auditLog.findMany({
    where: { entityType: 'User', entityId: id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true, action: true, actorEmail: true, actorRole: true,
      metadata: true, ipAddress: true, createdAt: true,
    },
  });
  return NextResponse.json(logs);
}
