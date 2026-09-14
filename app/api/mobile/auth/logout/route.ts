// Increment 10 — Workstream P: mobile logout (revoke current session).
import { NextResponse } from 'next/server';
import { verifyMobileSession, revokeSession } from '@/lib/mobile/auth';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const v = await verifyMobileSession(req);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  await revokeSession(v.ctx.sessionId);
  await writeAudit({
    actor: { id: v.ctx.userId ?? undefined, email: v.ctx.email, role: v.ctx.role },
    action: 'mobile.logout',
    entityType: 'MobileSession',
    entityId: v.ctx.sessionId,
    ...requestMeta(req),
  });
  return NextResponse.json({ ok: true });
}
