export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getFileUrl } from '@/lib/s3';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  const taskId = searchParams.get('taskId');

  const where: any = {};
  if (jobId) where.jobId = jobId;
  if (taskId) where.taskId = taskId;
  if (session.user.workerId) where.workerId = session.user.workerId;

  const logs = await prisma.activityLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { worker: { select: { name: true } } },
  });

  // Generate URLs for files
  const logsWithUrls = await Promise.all(
    (logs ?? []).map(async (log: any) => {
      let fileUrl = null;
      if (log?.cloudStoragePath) {
        try {
          fileUrl = await getFileUrl(log.cloudStoragePath, log.contentType ?? 'application/octet-stream', log.isPublic ?? false);
        } catch { /* skip */ }
      }
      return { ...log, fileUrl };
    })
  );

  return NextResponse.json(logsWithUrls);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const {
      jobId, taskId, activityType, description,
      cloudStoragePath, isPublic, contentType, fileName,
      latitude, longitude, gpsAccuracy,
    } = body ?? {};

    // Calculate distance if GPS and job location available
    let distanceFromJob: number | null = null;
    let proximityWarning = false;
    if (latitude && longitude && jobId) {
      const job = await prisma.job.findUnique({ where: { id: jobId }, select: { latitude: true, longitude: true } });
      if (job?.latitude && job?.longitude) {
        const R = 20902231;
        const dLat = (job.latitude - latitude) * Math.PI / 180;
        const dLon = (job.longitude - longitude) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(latitude * Math.PI / 180) * Math.cos(job.latitude * Math.PI / 180) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        distanceFromJob = Math.round(R * c);
        proximityWarning = distanceFromJob > 500;
      }
    }

    const log = await prisma.activityLog.create({
      data: {
        jobId, taskId, workerId: session.user.workerId,
        activityType, description,
        cloudStoragePath, isPublic: isPublic ?? false, contentType, fileName,
        latitude, longitude, gpsAccuracy,
        distanceFromJob, proximityWarning,
      },
    });

    return NextResponse.json(log);
  } catch (err: any) {
    console.error('Activity log error:', err);
    return NextResponse.json({ error: 'Failed to create activity' }, { status: 500 });
  }
}
