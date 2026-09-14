// Domain & SSL — get / update / delete a single domain. ADMIN only.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';
import { requireAdmin, requireAdminMutation } from '@/lib/domains/guard';
import { disableDomain } from '@/lib/domains/service';
import { DOMAIN_AUDIT, DOMAIN_ERROR } from '@/lib/domains/index';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.response;
  const { id } = await params;
  const domain = await prisma.hostedDomain.findUnique({ where: { id } });
  if (!domain) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ domain });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdminMutation(req);
  if (!g.ok) return g.response;
  const { id } = await params;

  const domain = await prisma.hostedDomain.findUnique({ where: { id } });
  if (!domain) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body?.displayName === 'string') {
    data.displayName = body.displayName.trim().slice(0, 120) || null;
  }
  if (typeof body?.expectedIpv4 === 'string') {
    data.expectedIpv4 = body.expectedIpv4.trim() || null;
  }
  if (typeof body?.expectedIpv6 === 'string') {
    data.expectedIpv6 = body.expectedIpv6.trim() || null;
  }

  const setPrimary = body?.isPrimary === true;

  const updated = await prisma.$transaction(async (tx) => {
    if (setPrimary) {
      await tx.hostedDomain.updateMany({ where: { isPrimary: true }, data: { isPrimary: false } });
      data.isPrimary = true;
    }
    return tx.hostedDomain.update({ where: { id }, data });
  });

  await writeAudit({
    actor: g.actor,
    action: DOMAIN_AUDIT.UPDATED,
    entityType: 'HostedDomain',
    entityId: id,
    metadata: { fields: Object.keys(data) },
    ...requestMeta(req),
  });

  return NextResponse.json({ domain: updated });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdminMutation(req);
  if (!g.ok) return g.response;
  const { id } = await params;

  const domain = await prisma.hostedDomain.findUnique({ where: { id } });
  if (!domain) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Disable (regenerates proxy config without this domain) before removing the
  // record, so we never leave the proxy serving a removed domain.
  const result = await disableDomain(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? DOMAIN_ERROR.PROXY_RELOAD_FAILED }, { status: 500 });
  }
  await prisma.hostedDomain.delete({ where: { id } });

  await writeAudit({
    actor: g.actor,
    action: DOMAIN_AUDIT.SSL_DISABLED,
    entityType: 'HostedDomain',
    entityId: id,
    metadata: { hostname: domain.hostname, removed: true },
    ...requestMeta(req),
  });

  return NextResponse.json({ ok: true });
}
