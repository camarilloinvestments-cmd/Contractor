export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

// POST: approve or return a closeout revision. Body: { action: 'APPROVE' | 'RETURN', notes? }
export async function POST(request: Request, { params }: { params: Promise<{ id: string; revisionId: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id, revisionId } = await params;

  try {
    const rev = await prisma.closeoutRevision.findUnique({ where: { id: revisionId } });
    if (!rev || rev.jobId !== id) return NextResponse.json({ error: 'Revision not found' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const action = body?.action ?? 'APPROVE';

    if (action === 'APPROVE') {
      const updated = await prisma.closeoutRevision.update({
        where: { id: revisionId },
        data: {
          status: 'APPROVED',
          approvedById: session.user.id,
          approvedAt: new Date(),
          notes: body?.notes ?? rev.notes,
        },
      });
      await writeAudit({
        actor: { id: session.user.id, email: session.user.email, role: session.user.role },
        action: 'closeout.approve',
        entityType: 'CloseoutRevision',
        entityId: revisionId,
        metadata: { jobId: id, revision: rev.revision },
        ...requestMeta(request),
      });
      return NextResponse.json(updated);
    }

    if (action === 'RETURN') {
      const updated = await prisma.closeoutRevision.update({
        where: { id: revisionId },
        data: { status: 'RETURNED', notes: body?.notes ?? rev.notes },
      });
      await writeAudit({
        actor: { id: session.user.id, email: session.user.email, role: session.user.role },
        action: 'closeout.return',
        entityType: 'CloseoutRevision',
        entityId: revisionId,
        metadata: { jobId: id, revision: rev.revision },
        ...requestMeta(request),
      });
      return NextResponse.json(updated);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    console.error('Approve closeout error:', err);
    return NextResponse.json({ error: 'Failed to update closeout' }, { status: 500 });
  }
}
