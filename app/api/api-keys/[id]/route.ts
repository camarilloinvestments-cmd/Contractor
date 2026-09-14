// Workstream W — revoke an API key. ADMIN only.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body.action === 'revoke' ? 'revoke' : null;
  if (!action) return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
  const rec = await prisma.apiKey.update({
    where: { id },
    data: { status: 'REVOKED', revokedAt: new Date() },
    select: { id: true, name: true, status: true, revokedAt: true },
  });
  const meta = requestMeta(req);
  await writeAudit({ actor: { id: session.user.id, email: session.user.email, role: session.user.role }, action: 'api_key.revoke', entityType: 'ApiKey', entityId: id, ...meta });
  return NextResponse.json({ key: rec });
}
