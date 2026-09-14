// Increment 8 (Workstream N) — Live Operations Map aggregation.
// Returns job sites, worker positions (mobile stream), crews, and vehicle
// positions (Geotab stream) as SEPARATE layers. Worker mobile GPS and truck
// Geotab GPS are never merged. Role-gated:
//   ADMIN / PROJECT_MANAGER  -> full operational picture
//   FIELD_WORKER             -> own position + assigned vehicle + current jobs
//   (SALES / others)         -> no internal fleet data
// This endpoint is polled by the Live Map client; it does not depend on any
// browser staying open (sync runs server-side on its own checkpoint).
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { isStale, ageSeconds } from '@/lib/geo';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = session.user.role;
  const isManager = role === 'ADMIN' || role === 'PROJECT_MANAGER';

  // Resolve the caller's own worker id for field-worker scoping.
  let ownWorkerId: string | null = null;
  if (!isManager) {
    const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { workerId: true } });
    ownWorkerId = u?.workerId ?? null;
    if (!ownWorkerId) {
      // No fleet visibility for non-operational roles without a worker profile.
      return NextResponse.json({ jobs: [], workers: [], crews: [], vehicles: [], scope: 'none' });
    }
  }

  // Job sites with coordinates (active/relevant statuses).
  const jobWhere: any = { latitude: { not: null }, longitude: { not: null }, status: { in: ['ACTIVE', 'IN_PROGRESS', 'UNDER_REVIEW', 'APPROVED'] } };
  const jobs = await prisma.job.findMany({
    where: jobWhere,
    select: { id: true, jobNumber: true, jobName: true, latitude: true, longitude: true, status: true, geofenceRadiusFeet: true, address: true, city: true, state: true },
  });

  // Vehicles + current state (Geotab stream).
  const vehicles = await prisma.fleetVehicle.findMany({
    where: isManager ? { active: true } : { active: true, assignedWorkerId: ownWorkerId ?? undefined },
    include: {
      state: true,
      crew: { select: { id: true, name: true, subcontractorCompany: true } },
      worker: { select: { id: true, name: true } },
      currentJob: { select: { id: true, jobNumber: true, jobName: true } },
    },
  });
  const vehicleRows = vehicles
    .filter((v) => v.state)
    .map((v) => ({
      id: v.id,
      name: v.name,
      vehicleNumber: v.vehicleNumber,
      source: 'GEOTAB',
      latitude: v.state!.latitude,
      longitude: v.state!.longitude,
      speed: v.state!.speed,
      bearing: v.state!.bearing,
      motion: v.state!.motion,
      communicating: v.state!.communicating,
      driverName: v.state!.currentDriverName,
      recordedAt: v.state!.recordedAt,
      lastUpdateAgeSeconds: ageSeconds(v.state!.recordedAt),
      stale: isStale(v.state!.recordedAt),
      crew: v.crew,
      worker: v.worker,
      currentJob: v.currentJob,
      subcontractorCompany: v.subcontractorCompany,
    }));

  // Worker positions (mobile stream) — latest location per worker.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const locWhere: any = { recordedAt: { gte: since } };
  if (!isManager) locWhere.workerId = ownWorkerId;
  const recentLocations = await prisma.workerLocation.findMany({
    where: locWhere,
    orderBy: { recordedAt: 'desc' },
    include: { worker: { select: { id: true, name: true, workerType: true, companyName: true, crewId: true } } },
  });
  const seen = new Set<string>();
  const workerRows: any[] = [];
  for (const loc of recentLocations) {
    if (seen.has(loc.workerId)) continue;
    seen.add(loc.workerId);
    workerRows.push({
      id: loc.worker.id,
      name: loc.worker.name,
      workerType: loc.worker.workerType,
      companyName: loc.worker.companyName,
      crewId: loc.worker.crewId,
      source: loc.source,
      latitude: loc.latitude,
      longitude: loc.longitude,
      accuracy: loc.accuracy,
      recordedAt: loc.recordedAt,
      lastUpdateAgeSeconds: ageSeconds(loc.recordedAt),
      stale: isStale(loc.recordedAt),
    });
  }

  const crews = isManager
    ? await prisma.crew.findMany({ where: { active: true }, select: { id: true, name: true, subcontractorCompany: true } })
    : [];

  return NextResponse.json({
    scope: isManager ? 'full' : 'self',
    jobs,
    workers: workerRows,
    crews,
    vehicles: vehicleRows,
  });
}
