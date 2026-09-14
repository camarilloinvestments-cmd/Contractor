// Increment 10 — Workstream R: admin / project-manager review of a Field Evidence
// Package. APPROVE marks it ACCEPTED (immutable evidence); REJECT flags it and
// returns it for correction with a required note. Evidence is never edited or
// deleted here — only its review status changes.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';
import { getFileUrl } from '@/lib/s3';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user || (session.user.role !== 'ADMIN' && session.user.role !== 'PROJECT_MANAGER')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pkg = await prisma.fieldEvidencePackage.findUnique({
    where: { id },
    include: {
      assets: true,
      job: { select: { id: true, jobNumber: true, jobName: true, address: true, city: true, state: true, latitude: true, longitude: true } },
      worker: { select: { id: true, name: true, companyName: true } },
      crew: { select: { id: true, name: true } },
      task: { select: { id: true, description: true } },
      device: { select: { id: true, deviceName: true, platform: true } },
    },
  });

  if (!pkg) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Resolve short-lived signed URLs for each asset + signature (never stored).
  const assetUrls: Record<string, string> = {};
  await Promise.all(
    pkg.assets.map(async (a) => {
      try {
        assetUrls[a.id] = await getFileUrl(a.cloudStoragePath, a.contentType ?? 'application/octet-stream', false);
      } catch {
        /* ignore individual failures */
      }
    })
  );
  let signatureUrl: string | null = null;
  if (pkg.signatureStoragePath) {
    try {
      signatureUrl = await getFileUrl(pkg.signatureStoragePath, pkg.signatureContentType ?? 'image/png', false);
    } catch {
      signatureUrl = null;
    }
  }

  return NextResponse.json({ package: pkg, assetUrls, signatureUrl });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user || (session.user.role !== 'ADMIN' && session.user.role !== 'PROJECT_MANAGER')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { action?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const action = (body.action || '').toUpperCase();
  const note = typeof body.note === 'string' ? body.note.trim() : '';

  if (action !== 'APPROVE' && action !== 'REJECT') {
    return NextResponse.json({ error: 'action must be APPROVE or REJECT' }, { status: 400 });
  }
  if (action === 'REJECT' && !note) {
    return NextResponse.json({ error: 'A note is required when returning evidence for correction' }, { status: 400 });
  }

  const existing = await prisma.fieldEvidencePackage.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const newStatus = action === 'APPROVE' ? 'ACCEPTED' : 'FLAGGED';

  const updated = await prisma.fieldEvidencePackage.update({
    where: { id },
    data: {
      status: newStatus,
      reviewedById: session.user.id,
      reviewedAt: new Date(),
      reviewNote: note || null,
    },
  });

  await writeAudit({
    actor: { id: session.user.id, email: session.user.email, role: session.user.role },
    action: action === 'APPROVE' ? 'evidence.approve' : 'evidence.reject',
    entityType: 'FieldEvidencePackage',
    entityId: id,
    metadata: { previousStatus: existing.status, newStatus, note: note || null },
    ...requestMeta(req),
  });

  return NextResponse.json({ package: updated });
}
