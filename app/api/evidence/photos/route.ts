// Admin / project-manager review list of field photo evidence (spec §12).
// Returns records with signed URLs for the watermarked derivative (safe to show).
// Original bytes are downloaded only through the detail route with a permission gate.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getFileUrl } from '@/lib/s3';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || (session.user.role !== 'ADMIN' && session.user.role !== 'PROJECT_MANAGER')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const jobId = url.searchParams.get('jobId') || undefined;
  const taskId = url.searchParams.get('taskId') || undefined;
  const status = url.searchParams.get('status') || undefined;

  const where: Record<string, unknown> = {};
  if (jobId) where.jobId = jobId;
  if (taskId) where.taskId = taskId;
  if (status) where.status = status;

  const rows = await prisma.fieldPhotoEvidence.findMany({
    where,
    orderBy: { capturedAt: 'desc' },
    take: 200,
    include: {
      job: { select: { id: true, jobNumber: true, jobName: true } },
      task: { select: { id: true, billingCode: true, description: true } },
      capturedBy: { select: { id: true, name: true, email: true } },
    },
  });

  const items = await Promise.all(
    rows.map(async (r: any) => {
      let watermarkedUrl: string | null = null;
      if (r.watermarkedStoragePath) {
        try {
          watermarkedUrl = await getFileUrl(r.watermarkedStoragePath, r.watermarkedContentType ?? 'image/jpeg', false);
        } catch { watermarkedUrl = null; }
      }
      return {
        id: r.id,
        evidenceRef: r.evidenceRef,
        status: r.status,
        jobNumber: r.job?.jobNumber ?? null,
        jobName: r.job?.jobName ?? null,
        taskCode: r.task?.billingCode ?? null,
        taskDescription: r.task?.description ?? null,
        technicianName: r.technicianName ?? r.capturedBy?.name ?? r.capturedBy?.email ?? null,
        latitude: r.latitude,
        longitude: r.longitude,
        gpsAccuracyMeters: r.gpsAccuracyMeters,
        accuracyClass: r.accuracyClass,
        capturedAt: r.capturedAt,
        receivedAt: r.receivedAt,
        watermarkGeneratedAt: r.watermarkGeneratedAt,
        watermarkError: r.watermarkError,
        watermarkedUrl,
      };
    })
  );

  return NextResponse.json({ items });
}
