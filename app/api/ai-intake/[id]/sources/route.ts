export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';
import { requireManage } from '@/lib/rbac';
import { uploadBuffer } from '@/lib/s3';
import { detectKind, MAX_INTAKE_FILE_BYTES } from '@/lib/ai-intake/extract';

type Params = { params: Promise<{ id: string }> };

// POST /api/ai-intake/:id/sources  (multipart form-data, field "file")
// Stores the original file server-side and records an AiIntakeSource. The file is
// NOT sent to OpenAI here - that happens only on explicit Analyze.
export async function POST(request: Request, { params }: Params) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const actor = gate.user;
  const { id } = await params;

  const intake = await prisma.aiWorkIntake.findUnique({ where: { id } });
  if (!intake) return NextResponse.json({ error: 'Intake not found' }, { status: 404 });
  if (intake.status === 'IMPORTED' || intake.status === 'REJECTED') {
    return NextResponse.json({ error: 'Intake is finalized; cannot add sources' }, { status: 400 });
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

  const source = await prisma.aiIntakeSource.create({
    data: {
      intakeId: id,
      kind,
      originalFilename: filename,
      contentType,
      storagePath: cloud_storage_path,
      sizeBytes: bytes.length,
      sha256,
      sentToAi: false,
    },
  });

  await writeAudit({
    actor, action: 'ai_intake.source_added', entityType: 'AiWorkIntake', entityId: id,
    metadata: { sourceId: source.id, kind, sizeBytes: bytes.length, sha256 }, ...requestMeta(request),
  });

  return NextResponse.json({ source });
}

// DELETE /api/ai-intake/:id/sources?sourceId=...
export async function DELETE(request: Request, { params }: Params) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const actor = gate.user;
  const { id } = await params;

  const { searchParams } = new URL(request.url);
  const sourceId = searchParams.get('sourceId');
  if (!sourceId) return NextResponse.json({ error: 'sourceId is required' }, { status: 400 });

  const source = await prisma.aiIntakeSource.findUnique({ where: { id: sourceId } });
  if (!source || source.intakeId !== id) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  }
  await prisma.aiIntakeSource.delete({ where: { id: sourceId } });

  await writeAudit({
    actor, action: 'ai_intake.source_removed', entityType: 'AiWorkIntake', entityId: id,
    metadata: { sourceId }, ...requestMeta(request),
  });
  return NextResponse.json({ ok: true });
}
