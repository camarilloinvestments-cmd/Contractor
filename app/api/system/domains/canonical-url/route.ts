// Domain & SSL — canonical URL (NEXTAUTH_URL) management. ADMIN only.
// GET  → current canonical URL status (never returns secrets).
// POST → { action: 'preview' | 'apply' | 'rollback', hostname? }
// Applying requires the domain to be the ACTIVE primary (§14/§21): we never
// point the canonical URL at a domain that isn't serving a valid certificate.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';
import { requireAdmin, requireAdminMutation } from '@/lib/domains/guard';
import {
  previewCanonicalUrl,
  applyCanonicalUrl,
  rollbackCanonicalUrl,
  statusCanonicalUrl,
} from '@/lib/domains/appurl';
import { validateHostname } from '@/lib/domains/hostname';
import { DOMAIN_AUDIT, DOMAIN_ERROR, DOMAIN_STATUS } from '@/lib/domains/index';

export const dynamic = 'force-dynamic';

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.response;
  const status = await statusCanonicalUrl();
  return NextResponse.json(status);
}

export async function POST(req: Request) {
  const g = await requireAdminMutation(req);
  if (!g.ok) return g.response;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const action = body?.action;

  if (action === 'rollback') {
    const r = await rollbackCanonicalUrl();
    await writeAudit({
      actor: g.actor,
      action: DOMAIN_AUDIT.CANONICAL_URL_ROLLED_BACK,
      entityType: 'AppConfig',
      metadata: { ok: r.ok },
      ...requestMeta(req),
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  if (action === 'preview' || action === 'apply') {
    const v = validateHostname(body?.hostname);
    if (!v.ok) return NextResponse.json({ error: DOMAIN_ERROR.INVALID_HOSTNAME }, { status: 400 });

    if (action === 'preview') {
      const r = await previewCanonicalUrl(v.hostname);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }

    // apply: require the domain to exist and be ACTIVE before cutover (§21).
    const domain = await prisma.hostedDomain.findUnique({ where: { hostname: v.hostname } });
    if (!domain || domain.status !== DOMAIN_STATUS.ACTIVE) {
      return NextResponse.json({ error: DOMAIN_ERROR.NOT_VERIFIED }, { status: 400 });
    }
    const r = await applyCanonicalUrl(v.hostname);
    await writeAudit({
      actor: g.actor,
      action: DOMAIN_AUDIT.CANONICAL_URL_CHANGED,
      entityType: 'AppConfig',
      metadata: { ok: r.ok, hostname: v.hostname },
      ...requestMeta(req),
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
