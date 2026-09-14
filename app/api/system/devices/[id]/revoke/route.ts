// Increment 10 — Workstream P: admin revoke a mobile device (kills all its sessions).
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { revokeDevice } from '@/lib/mobile/auth';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await revokeDevice(id, session.user.id);

  await writeAudit({
    actor: { id: session.user.id, email: session.user.email, role: session.user.role },
    action: 'system.device_revoke',
    entityType: 'MobileDevice',
    entityId: id,
    ...requestMeta(req),
  });

  return NextResponse.json({ ok: true });
}
