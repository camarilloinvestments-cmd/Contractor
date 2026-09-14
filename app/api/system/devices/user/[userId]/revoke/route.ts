// Increment 10 — Workstream P: admin revoke ALL devices for a user.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { revokeAllUserDevices } from '@/lib/mobile/auth';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const count = await revokeAllUserDevices(userId, session.user.id);
  await writeAudit({
    actor: { id: session.user.id, email: session.user.email, role: session.user.role },
    action: 'system.user_devices_revoke',
    entityType: 'User',
    entityId: userId,
    metadata: { revokedDevices: count },
    ...requestMeta(req),
  });
  return NextResponse.json({ ok: true, revokedDevices: count });
}
