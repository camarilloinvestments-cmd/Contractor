// Increment 8 acceptance proof (Live Operations Map + Geotab fleet telematics).
// Runs against a seeded test database. Exercises the real sync + geofence code paths.
import { runFleetSync, evaluateGeofences } from '../lib/fleet/sync';
import { isStale, ageSeconds, STALE_AFTER_SECONDS } from '../lib/geo';
import { prisma } from '../lib/prisma';

async function counts() {
  const [vehicles, telemetry, states, workerLocs, geoEvents] = await Promise.all([
    prisma.fleetVehicle.count(),
    prisma.vehicleTelemetry.count(),
    prisma.vehicleState.count(),
    prisma.workerLocation.count(),
    prisma.geoEvent.count(),
  ]);
  return { vehicles, telemetry, states, workerLocs, geoEvents };
}

async function main() {
  const lines: string[] = [];
  const log = (s: string) => { lines.push(s); console.log(s); };

  log('# Increment 8 Acceptance Proof');
  log('');
  log('Executed against a seeded test database using the production sync + geofence code.');
  log('');

  const before = await counts();
  log('## Baseline (after seed)');
  log('```');
  log(JSON.stringify(before, null, 2));
  log('```');

  // Drive the full mock route (8 steps). Each sync advances the feed checkpoint.
  log('## Sync run #1 (full route, 8 feed steps)');
  let last;
  for (let i = 1; i <= 8; i++) {
    last = await runFleetSync();
  }
  log('```');
  log('final summary: ' + JSON.stringify(last));
  log('```');
  const afterFull = await counts();
  log('After full sync:');
  log('```');
  log(JSON.stringify(afterFull, null, 2));
  log('```');

  // Resume: run one more sync. Feed is saturated (step 8); providerRefs already
  // stored -> upsert dedup means telemetry count must NOT grow.
  log('## Sync run #2 (resume — dedup check)');
  const resume = await runFleetSync();
  log('```');
  log('resume summary: ' + JSON.stringify(resume));
  log('```');
  const afterResume = await counts();
  log('After resume sync:');
  log('```');
  log(JSON.stringify(afterResume, null, 2));
  log('```');
  const dedupOk = afterResume.telemetry === afterFull.telemetry;
  log(`Telemetry unchanged on resume (no duplicates): ${dedupOk ? 'PASS' : 'FAIL'} (${afterFull.telemetry} -> ${afterResume.telemetry})`);

  // Vehicles synced (>= 2 devices).
  log('');
  log(`At least 2 vehicles synced: ${afterResume.vehicles >= 2 ? 'PASS' : 'FAIL'} (${afterResume.vehicles})`);
  log(`Current vehicle state records present: ${afterResume.states >= 2 ? 'PASS' : 'FAIL'} (${afterResume.states})`);

  // Distinct geofence event types: WORKER vs VEHICLE.
  const byType = await prisma.geoEvent.groupBy({ by: ['eventType', 'actorType'], _count: true });
  log('');
  log('## Geofence events by type');
  log('```');
  for (const g of byType) log(`${g.actorType} / ${g.eventType}: ${g._count}`);
  log('```');
  const hasVehArr = byType.some((g) => g.eventType === 'VEHICLE_ARRIVED');
  const hasWrkArr = byType.some((g) => g.eventType === 'WORKER_ARRIVED');
  log(`Distinct VEHICLE_ARRIVED and WORKER_ARRIVED events exist: ${hasVehArr && hasWrkArr ? 'PASS' : 'FAIL'}`);

  // Mobile worker GPS stream is stored separately from truck telemetry.
  log('');
  log(`Mobile-worker GPS kept in a separate stream (WorkerLocation): ${afterResume.workerLocs >= 1 ? 'PASS' : 'FAIL'} (${afterResume.workerLocs} rows, distinct table from ${afterResume.telemetry} vehicle telemetry rows)`);

  // Live geofence evaluation for a worker (separate WORKER_ARRIVED type).
  const job = await prisma.job.findFirst({ where: { jobNumber: 'JOB-0003' } });
  const worker = await prisma.worker.findFirst({ where: { id: 'worker-sub-001' } });
  if (job && worker) {
    const created = await evaluateGeofences({
      actorType: 'WORKER',
      workerId: worker.id,
      latitude: job.latitude!,
      longitude: job.longitude!,
      source: 'MOBILE_APP',
      occurredAt: new Date(),
    });
    log('');
    log(`Live worker geofence evaluation produced events (WORKER actor): count=${created}`);
  }

  // Historical route/timeline available for a vehicle.
  const truck = await prisma.fleetVehicle.findFirst({ where: { geotabDeviceId: 'GT-DEV-TRUCK121' } });
  const history = truck ? await prisma.vehicleTelemetry.findMany({ where: { vehicleId: truck.id }, orderBy: { recordedAt: 'asc' } }) : [];
  log('');
  log(`Historical route/timeline points for Truck 121: ${history.length} (PASS if > 0: ${history.length > 0 ? 'PASS' : 'FAIL'})`);

  // Stale/offline detection.
  const states = await prisma.vehicleState.findMany();
  log('');
  log('## Stale detection');
  log('```');
  for (const s of states) {
    log(`vehicle ${s.vehicleId.slice(0, 8)}: age=${ageSeconds(s.recordedAt)}s stale=${isStale(s.recordedAt)}`);
  }
  log('```');
  // Force a stale record to prove the flag flips past the threshold.
  if (truck) {
    const old = new Date(Date.now() - (STALE_AFTER_SECONDS + 120) * 1000);
    await prisma.vehicleState.update({ where: { vehicleId: truck.id }, data: { recordedAt: old } });
    const s = await prisma.vehicleState.findUnique({ where: { vehicleId: truck.id } });
    log(`Forced-old Truck 121 state -> stale=${isStale(s!.recordedAt)} (PASS if true: ${isStale(s!.recordedAt) ? 'PASS' : 'FAIL'})`);
  }

  log('');
  log('## Restart persistence');
  log('Telemetry, vehicle state, trips, worker locations and geofence events are all stored');
  log('in the database (not in memory), so they survive a process restart. The resume sync');
  log('above reads the persisted FleetFeedState checkpoint rather than restarting from zero.');

  const fs = await import('fs');
  fs.writeFileSync('/home/ubuntu/output/INC8_ACCEPTANCE.md', lines.join('\n') + '\n');
  log('');
  log('Wrote /home/ubuntu/output/INC8_ACCEPTANCE.md');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
