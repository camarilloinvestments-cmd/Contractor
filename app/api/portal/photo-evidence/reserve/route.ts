export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { generateEvidenceUploadUrl } from '@/lib/s3';
import {
  ALLOWED_EVIDENCE_MIME as ALLOWED_MIME,
  MAX_UPLOAD_BYTES,
  RESERVATION_TTL_MS,
  UPLOAD_URL_TTL_SECONDS,
  extForMime,
} from '@/lib/evidence/upload-constants';

// Evidence upload reservation (§2/§3 cold-review).
// Server generates a high-entropy storage key under a dedicated evidence prefix,
// binds it to actor/task/job, and returns a presigned PUT URL that expires with
// the reservation. The client CANNOT supply an arbitrary path.

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // §1: field-tech must have a workerId
  const workerId = session.user.workerId;
  if (!workerId) {
    return NextResponse.json({ error: 'No worker profile associated with your account' }, { status: 403 });
  }

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { taskId, jobId, contentType, fileName } = body ?? {};
  if (!taskId || typeof taskId !== 'string') return NextResponse.json({ error: 'Missing taskId' }, { status: 400 });
  if (!jobId || typeof jobId !== 'string') return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });

  // Validate MIME
  const mime = (contentType || 'image/jpeg').toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json({ error: `Unsupported file type: ${mime}. Allowed: JPEG, PNG, WebP, HEIC` }, { status: 400 });
  }

  // §1: Verify task exists, is assigned to this worker, and belongs to the submitted job.
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, jobId: true, workerId: true },
  });
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  if (task.workerId !== workerId) {
    return NextResponse.json({ error: 'You are not assigned to this task' }, { status: 403 });
  }
  if (task.jobId !== jobId) {
    return NextResponse.json({ error: 'Task does not belong to the specified work order' }, { status: 403 });
  }

  // Verify job exists (for project/prime isolation if applicable).
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
  if (!job) return NextResponse.json({ error: 'Work order not found' }, { status: 404 });

  // Generate a server-controlled, high-entropy storage path (dedicated prefix).
  // fileName is intentionally NOT part of the key — it is not a security or
  // uniqueness boundary. The UUID inside generateEvidenceUploadUrl is.
  const ext = extForMime(mime);
  const { uploadUrl, cloud_storage_path } = await generateEvidenceUploadUrl(
    mime, ext, UPLOAD_URL_TTL_SECONDS
  );

  const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);

  // Persist reservation bound to actor + task + job.
  const reservation = await prisma.evidenceUploadReservation.create({
    data: {
      userId: session.user.id,
      workerId,
      jobId: job.id,
      taskId: task.id,
      storagePath: cloud_storage_path,
      contentType: mime,
      maxSizeBytes: MAX_UPLOAD_BYTES,
      expiresAt,
    },
  });

  return NextResponse.json({
    reservationId: reservation.id,
    uploadUrl,
    maxSizeBytes: MAX_UPLOAD_BYTES,
    expiresAt: expiresAt.toISOString(),
  });
}
