export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';
import { requireManage } from '@/lib/rbac';
import { uploadBuffer, deleteFile } from '@/lib/s3';
import { detectKind, MAX_INTAKE_FILE_BYTES } from '@/lib/ai-intake/extract';
import { registerIntakeSource, removeIntakeSource, IntakeSourceNotFoundError } from '@/lib/ai-intake/sources';
import { MUTABLE_DRAFT_STATUSES, IntakeStateLockError } from '@/lib/ai-intake/state-lock';

type Params = { params: Promise<{ id: string }> };

const DRAFT_MUTABLE = new Set<string>([...MUTABLE_DRAFT_STATUSES]);

// POST /api/ai-intake/:id/sources  (multipart form-data, field "file")
// Stores the original file server-side and records an AiIntakeSource. The file is
// NOT sent to OpenAI here - that happens only on explicit Analyze.
//
// Source registration is a DRAFT mutation: it goes through the SAME state lock as
// item edits (registerIntakeSource -> claimForDraftEdit), so it fails closed
// while the intake is ANALYZING / APPROVING / IMPORTED / REJECTED. An early
// state pre-check avoids an unnecessary upload, but the AUTHORITATIVE guard is
// the transactional claim; if the state races after upload, the just-uploaded
// object is deleted so it is not orphaned.
export async function POST(request: Request, { params }: Params) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const actor = gate.user;
  const { id } = await params;

  const pre = await prisma.aiWorkIntake.findUnique({ where: { id }, select: { status: true } });
  if (!pre) return NextResponse.json({ error: 'Intake not found' }, { status: 404 });
  // Fast pre-check to avoid uploading when clearly not mutable. Not authoritative.
  if (!DRAFT_MUTABLE.has(pre.status)) {
    return NextResponse.json(
      { error: `Intake is currently ${pre.status.toLowerCase()} and cannot accept sources` },
      { status: 409 },
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  const blob = file as unknown as File;
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (bytes.length === 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 });
  if (bytes.length > MAX_INTAKE_FILE_BYTES) {
    return NextResponse.json({ error: 'File exceeds 25MB limit' }, { status: 400 });
  }

  const filename = blob.name || 'upload';
  const contentType = blob.type || 'application/octet-stream';
  const kind = detectKind(filename, contentType);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

  const { cloud_storage_path } = await uploadBuffer(bytes, filename, contentType, 'ai-intake/sources');

  let source;
  try {
    source = await registerIntakeSource(id, {
      kind,
      originalFilename: filename,
      contentType,
      storagePath: cloud_storage_path,
      sizeBytes: bytes.length,
      sha256,
    });
  } catch (err) {
    if (err instanceof IntakeStateLockError) {
      // Lost the state race after upload - clean up the orphaned object.
      await deleteFile(cloud_storage_path).catch(() => {});
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }

  await writeAudit({
    actor, action: 'ai_intake.source_added', entityType: 'AiWorkIntake', entityId: id,
    metadata: { sourceId: source.id, kind, sizeBytes: bytes.length, sha256 }, ...requestMeta(request),
  });

  return NextResponse.json({ source });
}

// DELETE /api/ai-intake/:id/sources?sourceId=...
// Source removal is a DRAFT mutation and uses the same state lock; it fails
// closed while the intake is ANALYZING / APPROVING / IMPORTED / REJECTED.
export async function DELETE(request: Request, { params }: Params) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const actor = gate.user;
  const { id } = await params;

  const { searchParams } = new URL(request.url);
  const sourceId = searchParams.get('sourceId');
  if (!sourceId) return NextResponse.json({ error: 'sourceId is required' }, { status: 400 });

  try {
    await removeIntakeSource(id, sourceId);
  } catch (err) {
    if (err instanceof IntakeSourceNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof IntakeStateLockError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }

  await writeAudit({
    actor, action: 'ai_intake.source_removed', entityType: 'AiWorkIntake', entityId: id,
    metadata: { sourceId }, ...requestMeta(request),
  });
  return NextResponse.json({ ok: true });
}
