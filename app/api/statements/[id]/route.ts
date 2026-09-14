export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManage } from '@/lib/rbac';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const { id } = await params;
  const statement = await prisma.statement.findUnique({
    where: { id },
    include: {
      primeContractor: true,
      project: true,
      lines: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!statement) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const sends = await prisma.documentSend.findMany({
    where: { documentType: 'STATEMENT', documentId: id },
    orderBy: { createdAt: 'desc' },
  });
  const revisions = await prisma.documentRevision.findMany({
    where: { documentType: 'STATEMENT', documentId: id },
    orderBy: { revision: 'desc' },
    select: { id: true, revision: true, createdAt: true, createdById: true },
  });
  return NextResponse.json({ statement, sends, revisions });
}
