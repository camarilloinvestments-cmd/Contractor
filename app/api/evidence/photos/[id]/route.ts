// Field photo evidence detail + download + admin GPS correction (spec §12/§14).
// - GET returns full metadata + signed URLs for original & watermarked.
//   `?download=original|watermarked` returns a single signed URL and writes an
//   `evidence.photo_downloaded` audit. Original download is ADMIN-only.
// - PATCH (ADMIN) records an administrative GPS correction WITHOUT overwriting
//   the captured field values (they remain immutable field truth).
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getFileUrl } from '@/lib/s3';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user || (session.user.role !== 'ADMIN' && session.user.role !== 'PROJECT_MANAGER')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const isAdmin = session.user.role === 'ADMIN';

  const rec = await prisma.fieldPhotoEvidence.findUnique({
    where: { id },
    include: {
      job: { select: { id: true, jobNumber: true, jobName: true, address: true, city: true, state: true } },
      task: { select: { id: true, billingCode: true, description: true } },
      capturedBy: { select: { id: true, name: true, email: true } },
    },
  });
  if (!rec) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(req.url);
  const download = url.searchParams.get('download');

  if (download === 'original' || download === 'watermarked') {
    if (download === 'original' && !isAdmin) {
      return NextResponse.json({ error: 'Only administrators may download the original photo' }, { status: 403 });
    }
    const path = download === 'original' ? rec.originalStoragePath : rec.watermarkedStoragePath;
    const ct = download === 'original' ? rec.originalContentType : (rec.watermarkedContentType ?? 'image/jpeg');
    if (!path) return NextResponse.json({ error: `${download} not available` }, { status: 404 });
    let signed: string;
    try {
      signed = await getFileUrl(path, ct, false);
    } catch {
      return NextResponse.json({ error: 'Failed to sign URL' }, { status: 500 });
    }
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'evidence.photo_downloaded',
      entityType: 'FieldPhotoEvidence',
      entityId: rec.id,
      metadata: { evidenceRef: rec.evidenceRef, variant: download },
      ...requestMeta(req),
    });
    return NextResponse.json({ url: signed, variant: download });
  }

  let originalUrl: string | null = null;
  let watermarkedUrl: string | null = null;
  if (isAdmin) {
    try { originalUrl = await getFileUrl(rec.originalStoragePath, rec.originalContentType, false); } catch { originalUrl = null; }
  }
  if (rec.watermarkedStoragePath) {
    try { watermarkedUrl = await getFileUrl(rec.watermarkedStoragePath, rec.watermarkedContentType ?? 'image/jpeg', false); } catch { watermarkedUrl = null; }
  }

  return NextResponse.json({ record: rec, originalUrl, watermarkedUrl, canDownloadOriginal: isAdmin });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { correctedLatitude?: number; correctedLongitude?: number; correctionReason?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const lat = Number(body.correctedLatitude);
  const lon = Number(body.correctedLongitude);
  const reason = typeof body.correctionReason === 'string' ? body.correctionReason.trim() : '';
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: 'Valid corrected latitude and longitude are required' }, { status: 400 });
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: 'Coordinates out of range' }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: 'A correction reason is required' }, { status: 400 });
  }

  const existing = await prisma.fieldPhotoEvidence.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const updated = await prisma.fieldPhotoEvidence.update({
    where: { id },
    data: {
      correctedLatitude: lat,
      correctedLongitude: lon,
      correctionReason: reason,
      correctedByUserId: session.user.id,
      correctedAt: new Date(),
    },
  });

  await writeAudit({
    actor: { id: session.user.id, email: session.user.email, role: session.user.role },
    action: 'evidence.location_corrected',
    entityType: 'FieldPhotoEvidence',
    entityId: id,
    metadata: {
      evidenceRef: existing.evidenceRef,
      capturedLatitude: existing.latitude,
      capturedLongitude: existing.longitude,
      correctedLatitude: lat,
      correctedLongitude: lon,
      reason,
    },
    ...requestMeta(req),
  });

  return NextResponse.json({ record: updated });
}
