// Increment 10 — Workstream P: admin revoke a single mobile session.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { revokeSession } from '@/lib/mobile/auth';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await revokeSession(id);
  await writeAudit({
    actor: { id: session.user.id, email: session.user.email, role: session.user.role },
    action: 'system.session_revoke',
    entityType: 'MobileSession',
    entityId: id,
    ...requestMeta(req),
  });
  return NextResponse.json({ ok: true });
}
