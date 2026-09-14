// Domain & SSL — list + create. ADMIN only. Never returns private key material.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';
import { requireAdmin, requireAdminMutation } from '@/lib/domains/guard';
import { validateHostname } from '@/lib/domains/hostname';
import { DOMAIN_AUDIT, DOMAIN_ERROR, DOMAIN_STATUS } from '@/lib/domains/index';

export const dynamic = 'force-dynamic';

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.response;
  const domains = await prisma.hostedDomain.findMany({ orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] });
  return NextResponse.json({ domains });
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

  const v = validateHostname(body?.hostname);
  if (!v.ok) {
    return NextResponse.json({ error: DOMAIN_ERROR.INVALID_HOSTNAME, detail: v.reason }, { status: 400 });
  }

  const existing = await prisma.hostedDomain.findUnique({ where: { hostname: v.hostname } });
  if (existing) {
    return NextResponse.json({ error: DOMAIN_ERROR.DOMAIN_IN_USE }, { status: 409 });
  }

  const displayName =
    typeof body?.displayName === 'string' && body.displayName.trim()
      ? body.displayName.trim().slice(0, 120)
      : null;
  const isPrimary = body?.isPrimary === true;

  const created = await prisma.$transaction(async (tx) => {
    if (isPrimary) {
      await tx.hostedDomain.updateMany({ where: { isPrimary: true }, data: { isPrimary: false } });
    }
    return tx.hostedDomain.create({
      data: {
        hostname: v.hostname,
        displayName,
        isPrimary,
        status: DOMAIN_STATUS.PENDING,
      },
    });
  });

  await writeAudit({
    actor: g.actor,
    action: DOMAIN_AUDIT.CREATED,
    entityType: 'HostedDomain',
    entityId: created.id,
    metadata: { hostname: created.hostname, isPrimary },
    ...requestMeta(req),
  });

  return NextResponse.json({ domain: created }, { status: 201 });
}
