export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const body = await request.json();
    const { latitude, longitude, gpsAccuracy } = body ?? {};

    const task = await prisma.task.update({
      where: { id },
      data: { status: 'IN_PROGRESS' },
      include: { job: true },
    });

    // Calculate distance from job if GPS available
    let distanceFromJob: number | null = null;
    let proximityWarning = false;
    if (latitude && longitude && task?.job?.latitude && task?.job?.longitude) {
      distanceFromJob = calculateDistanceFt(
        latitude, longitude, task.job.latitude, task.job.longitude
      );
      proximityWarning = distanceFromJob > 500;
    }

    await prisma.activityLog.create({
      data: {
        jobId: task?.jobId,
        taskId: id,
        workerId: session.user.workerId,
        activityType: 'CHECK_IN',
        description: 'Task started',
        latitude,
        longitude,
        gpsAccuracy,
        distanceFromJob,
        proximityWarning,
      },
    });

    // Update job status to IN_PROGRESS if it was ACTIVE
    if (task?.job?.status === 'ACTIVE') {
      await prisma.job.update({ where: { id: task.jobId }, data: { status: 'IN_PROGRESS' } });
    }

    return NextResponse.json({ success: true, distanceFromJob, proximityWarning });
  } catch (err: any) {
    console.error('Start task error:', err);
    return NextResponse.json({ error: 'Failed to start task' }, { status: 500 });
  }
}

function calculateDistanceFt(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 20902231; // Earth radius in feet
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}
