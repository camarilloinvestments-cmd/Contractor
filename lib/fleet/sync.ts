// Increment 8 — fleet synchronization + geofence event generation.
//
// Pulls the provider feed from the persisted checkpoint so synchronization can
// resume without re-fetching or duplicating historical records, upserts the
// latest vehicle state, appends deduplicated historical telemetry, and emits
// VEHICLE_ARRIVED / VEHICLE_LEFT geofence events (distinct from WORKER_* events).
import { prisma } from '@/lib/prisma';
import { getFleetProvider, getFleetSettings, toProviderConfig } from './index';
import { isInsideGeofence, DEFAULT_GEOFENCE_FEET } from '@/lib/geo';
import type { NormalizedStatus } from './provider';

const STATUS_FEED = 'DeviceStatusInfo';

export type SyncSummary = {
  ok: boolean;
  vehiclesUpserted: number;
  statusRecords: number;
  telemetryStored: number;
  eventsCreated: number;
  toVersion: string | null;
  message?: string;
};

// Evaluate geofence transitions for a single actor position against all active
// jobs that have coordinates. Emits an arrival/departure event only on a state
// change (edge-triggered), based on the most recent prior event per job.
export async function evaluateGeofences(opts: {
  actorType: 'WORKER' | 'VEHICLE';
  vehicleId?: string | null;
  workerId?: string | null;
  crewId?: string | null;
  latitude: number;
  longitude: number;
  source: 'MOBILE_APP' | 'GEOTAB' | 'JOB_SITE' | 'MANUAL' | 'OTHER_FLEET_PROVIDER';
  occurredAt: Date;
  providerRef?: string | null;
}): Promise<number> {
  const jobs = await prisma.job.findMany({
    where: {
      latitude: { not: null },
      longitude: { not: null },
      status: { in: ['ACTIVE', 'IN_PROGRESS', 'UNDER_REVIEW', 'APPROVED'] },
    },
    select: { id: true, latitude: true, longitude: true, geofenceRadiusFeet: true },
  });
  const arrivedType = opts.actorType === 'VEHICLE' ? 'VEHICLE_ARRIVED' : 'WORKER_ARRIVED';
  const leftType = opts.actorType === 'VEHICLE' ? 'VEHICLE_LEFT' : 'WORKER_LEFT';
  let created = 0;

  for (const job of jobs) {
    const radius = job.geofenceRadiusFeet ?? DEFAULT_GEOFENCE_FEET;
    const inside = isInsideGeofence(opts.latitude, opts.longitude, job.latitude!, job.longitude!, radius);
    const actorFilter =
      opts.actorType === 'VEHICLE' ? { vehicleId: opts.vehicleId ?? undefined } : { workerId: opts.workerId ?? undefined };
    const last = await prisma.geoEvent.findFirst({
      where: { jobId: job.id, actorType: opts.actorType, ...actorFilter },
      orderBy: { occurredAt: 'desc' },
    });
    const wasInside = last?.eventType === arrivedType;
    if (inside && !wasInside) {
      await prisma.geoEvent.create({
        data: {
          eventType: arrivedType as any,
          actorType: opts.actorType as any,
          jobId: job.id,
          vehicleId: opts.vehicleId ?? null,
          workerId: opts.workerId ?? null,
          crewId: opts.crewId ?? null,
          latitude: opts.latitude,
          longitude: opts.longitude,
          occurredAt: opts.occurredAt,
          source: opts.source as any,
          providerRef: opts.providerRef ?? null,
        },
      });
      created++;
    } else if (!inside && wasInside) {
      await prisma.geoEvent.create({
        data: {
          eventType: leftType as any,
          actorType: opts.actorType as any,
          jobId: job.id,
          vehicleId: opts.vehicleId ?? null,
          workerId: opts.workerId ?? null,
          crewId: opts.crewId ?? null,
          latitude: opts.latitude,
          longitude: opts.longitude,
          occurredAt: opts.occurredAt,
          source: opts.source as any,
          providerRef: opts.providerRef ?? null,
        },
      });
      created++;
    }
  }
  return created;
}

export async function runFleetSync(): Promise<SyncSummary> {
  const settings = await getFleetSettings();
  if (!settings || !settings.enabled) {
    return { ok: false, vehiclesUpserted: 0, statusRecords: 0, telemetryStored: 0, eventsCreated: 0, toVersion: null, message: 'Geotab integration is not enabled.' };
  }
  if (!settings.syncEnabled) {
    return { ok: false, vehiclesUpserted: 0, statusRecords: 0, telemetryStored: 0, eventsCreated: 0, toVersion: null, message: 'Sync is disabled for the Geotab integration.' };
  }

  const provider = getFleetProvider(settings);
  const cfg = toProviderConfig(settings);

  try {
    // 1) Inventory: upsert vehicles by (provider, geotabDeviceId).
    const vehicles = await provider.listVehicles(cfg);
    let vehiclesUpserted = 0;
    for (const v of vehicles) {
      await prisma.fleetVehicle.upsert({
        where: { provider_geotabDeviceId: { provider: 'GEOTAB', geotabDeviceId: v.providerDeviceId } },
        create: {
          provider: 'GEOTAB',
          geotabDeviceId: v.providerDeviceId,
          name: v.name,
          vehicleNumber: v.vehicleNumber ?? null,
          vin: v.vin ?? null,
          make: v.make ?? null,
          model: v.model ?? null,
          year: v.year ?? null,
          licensePlate: v.licensePlate ?? null,
        },
        update: {
          name: v.name,
          vehicleNumber: v.vehicleNumber ?? null,
          vin: v.vin ?? null,
          make: v.make ?? null,
          model: v.model ?? null,
          year: v.year ?? null,
          licensePlate: v.licensePlate ?? null,
        },
      });
      vehiclesUpserted++;
    }

    // 2) Status feed from the persisted checkpoint.
    const feedState = await prisma.fleetFeedState.findUnique({
      where: { provider_dataType: { provider: 'GEOTAB', dataType: STATUS_FEED } },
    });
    const { toVersion, data } = await provider.getStatusFeed(cfg, feedState?.fromVersion ?? null);

    // Map providerDeviceId -> vehicle row.
    const byDevice = new Map<string, { id: string }>();
    for (const v of await prisma.fleetVehicle.findMany({ where: { provider: 'GEOTAB' }, select: { id: true, geotabDeviceId: true } })) {
      if (v.geotabDeviceId) byDevice.set(v.geotabDeviceId, { id: v.id });
    }

    let telemetryStored = 0;
    let eventsCreated = 0;
    const telemetryRows: any[] = [];

    for (const s of data as NormalizedStatus[]) {
      const vehicle = byDevice.get(s.providerDeviceId);
      if (!vehicle) continue;
      const recordedAt = new Date(s.recordedAt);

      // Latest state (one row per vehicle).
      await prisma.vehicleState.upsert({
        where: { vehicleId: vehicle.id },
        create: {
          vehicleId: vehicle.id,
          latitude: s.latitude,
          longitude: s.longitude,
          recordedAt,
          speed: s.speed ?? null,
          bearing: s.bearing ?? null,
          motion: s.driving === true ? 'DRIVING' : s.driving === false ? 'STOPPED' : 'UNKNOWN',
          communicating: s.communicating ?? true,
          currentDriverName: s.driverName ?? null,
          lastUpdateAt: new Date(),
        },
        update: {
          latitude: s.latitude,
          longitude: s.longitude,
          recordedAt,
          speed: s.speed ?? null,
          bearing: s.bearing ?? null,
          motion: s.driving === true ? 'DRIVING' : s.driving === false ? 'STOPPED' : 'UNKNOWN',
          communicating: s.communicating ?? true,
          currentDriverName: s.driverName ?? null,
          lastUpdateAt: new Date(),
        },
      });

      telemetryRows.push({
        vehicleId: vehicle.id,
        source: 'GEOTAB',
        recordedAt,
        latitude: s.latitude,
        longitude: s.longitude,
        speed: s.speed ?? null,
        bearing: s.bearing ?? null,
        driverName: s.driverName ?? null,
        providerRef: s.providerRef ?? null,
      });

      // Geofence transitions for this vehicle.
      eventsCreated += await evaluateGeofences({
        actorType: 'VEHICLE',
        vehicleId: vehicle.id,
        latitude: s.latitude,
        longitude: s.longitude,
        source: 'GEOTAB',
        occurredAt: recordedAt,
        providerRef: s.providerRef ?? null,
      });
    }

    if (telemetryRows.length > 0) {
      const res = await prisma.vehicleTelemetry.createMany({ data: telemetryRows, skipDuplicates: true });
      telemetryStored = res.count;
    }

    // 3) Persist checkpoint.
    await prisma.fleetFeedState.upsert({
      where: { provider_dataType: { provider: 'GEOTAB', dataType: STATUS_FEED } },
      create: { provider: 'GEOTAB', dataType: STATUS_FEED, fromVersion: toVersion, lastSyncAt: new Date() },
      update: { fromVersion: toVersion, lastSyncAt: new Date() },
    });

    await prisma.fleetProviderSettings.update({
      where: { id: settings.id },
      data: { lastSuccessAt: new Date(), lastConnectionStatus: 'OK', lastSyncError: null },
    });

    return {
      ok: true,
      vehiclesUpserted,
      statusRecords: data.length,
      telemetryStored,
      eventsCreated,
      toVersion,
    };
  } catch (err) {
    const message = (err as Error).message || 'Fleet sync failed.';
    await prisma.fleetProviderSettings.update({
      where: { id: settings.id },
      data: { lastFailureAt: new Date(), lastConnectionStatus: 'FAILED', lastSyncError: message },
    }).catch(() => {});
    return { ok: false, vehiclesUpserted: 0, statusRecords: 0, telemetryStored: 0, eventsCreated: 0, toVersion: null, message };
  }
}
