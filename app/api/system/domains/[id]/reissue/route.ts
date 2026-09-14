// Domain & SSL — reissue certificate. ADMIN only, same-origin, rate-limited.
import { NextResponse } from 'next/server';
import { writeAudit, requestMeta } from '@/lib/audit';
import { requireAdminMutation } from '@/lib/domains/guard';
import { reissue, checkRateLimit } from '@/lib/domains/service';
import { DOMAIN_AUDIT, DOMAIN_ERROR } from '@/lib/domains/index';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdminMutation(req);
  if (!g.ok) return g.response;
  const { id } = await params;

  if (!checkRateLimit('reissue', id)) {
    return NextResponse.json({ error: DOMAIN_ERROR.RATE_LIMIT_OPERATION }, { status: 429 });
  }

  const result = await reissue(id);

  await writeAudit({
    actor: g.actor,
    action: DOMAIN_AUDIT.SSL_REISSUED,
    entityType: 'HostedDomain',
    entityId: id,
    metadata: { ok: result.ok, error: result.error ?? null },
    ...requestMeta(req),
  });

  return NextResponse.json(
    { ok: result.ok, error: result.error, domain: result.data },
    { status: result.ok ? 200 : 400 }
  );
}
