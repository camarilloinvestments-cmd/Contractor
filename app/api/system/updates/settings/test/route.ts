// Test the GitHub connection (private-repo aware). ADMIN only. Never returns the token.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { ensureUpdateSettings, toGithubConfig } from '@/lib/updates';
import { testGithubConnection } from '@/lib/updates/github';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const s = await ensureUpdateSettings();
  const cfg = toGithubConfig(s);
  if (!cfg) return NextResponse.json({ ok: false, message: 'Configure GitHub owner and repository first.' }, { status: 400 });
  const result = await testGithubConnection(cfg);
  await writeAudit({
    actor: { id: session.user.id, email: session.user.email, role: session.user.role },
    action: 'system.update_test_connection',
    entityType: 'UpdateSettings',
    entityId: s.id,
    metadata: { ok: result.ok },
    ...requestMeta(req),
  });
  return NextResponse.json(result);
}
