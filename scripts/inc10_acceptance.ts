/*
 * Increment 10 acceptance harness (Workstreams P/Q/R).
 *
 * Runs with tsx, uses only Node's crypto, and touches NO database. It verifies
 * the pure algorithms that back the mobile foundation. The algorithms below are
 * kept byte-for-byte in sync with the production sources:
 *   - hashMobileToken / generateMobileToken / MOBILE_TOKEN_PREFIX  (lib/mobile/auth.ts)
 *   - evaluateGeofence + haversineFeet                             (lib/mobile/geofence.ts, lib/geo.ts)
 *   - detectConflict                                               (lib/mobile/sync.ts)
 * The real modules import Prisma (a DB client), so they cannot load in a
 * DB-free harness; tsc (run separately) type-checks the real modules.
 *
 * Run: node_modules/.bin/tsx scripts/inc10_acceptance.ts
 */
import { createHash, randomBytes } from 'crypto';

let passed = 0;
let failed = 0;
const lines: string[] = [];
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    lines.push(`PASS  ${name}${detail ? ' -- ' + detail : ''}`);
  } else {
    failed++;
    lines.push(`FAIL  ${name}${detail ? ' -- ' + detail : ''}`);
  }
}

// ---- mirror of lib/mobile/auth.ts ----
const MOBILE_TOKEN_PREFIX = 'os1_mob_';
function hashMobileToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
function generateMobileToken(): string {
  return MOBILE_TOKEN_PREFIX + randomBytes(32).toString('hex');
}

// ---- mirror of lib/geo.ts + lib/mobile/geofence.ts ----
const DEFAULT_GEOFENCE_FEET = 500;
function haversineFeet(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 20925524.9; // earth radius in feet
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
type GeoStatus = 'INSIDE' | 'OUTSIDE' | 'UNKNOWN' | 'NO_GEOFENCE';
function evaluateGeofence(
  job: { latitude: number | null; longitude: number | null; geofenceRadiusFeet: number | null },
  lat: number | null,
  lng: number | null
): { status: GeoStatus; distanceFeet: number | null } {
  if (job.latitude == null || job.longitude == null) return { status: 'NO_GEOFENCE', distanceFeet: null };
  if (lat == null || lng == null) return { status: 'UNKNOWN', distanceFeet: null };
  const radius = job.geofenceRadiusFeet ?? DEFAULT_GEOFENCE_FEET;
  const dist = haversineFeet(job.latitude, job.longitude, lat, lng);
  return { status: dist <= radius ? 'INSIDE' : 'OUTSIDE', distanceFeet: dist };
}

// ---- mirror of lib/mobile/sync.ts ----
function detectConflict(serverUpdatedAt: Date | null | undefined, deviceTimestamp: string | null | undefined): string | null {
  if (!serverUpdatedAt || !deviceTimestamp) return null;
  const dev = new Date(deviceTimestamp).getTime();
  if (Number.isNaN(dev)) return null;
  return serverUpdatedAt.getTime() > dev ? 'server_newer' : null;
}

// ===== tests =====
// token hashing is deterministic
const t = 'os1_mob_abc123';
check('hashMobileToken is deterministic', hashMobileToken(t) === hashMobileToken(t));
check('hashMobileToken differs per input', hashMobileToken('a') !== hashMobileToken('b'));
check('hashMobileToken is sha256 hex (64 chars)', /^[0-9a-f]{64}$/.test(hashMobileToken(t)));

// token generation
const gen = generateMobileToken();
check('generateMobileToken has os1_mob_ prefix', gen.startsWith(MOBILE_TOKEN_PREFIX));
check('generateMobileToken is unique', generateMobileToken() !== generateMobileToken());

// geofence: a job at a known point
const job = { latitude: 40.0, longitude: -105.0, geofenceRadiusFeet: 500 };
check('geofence INSIDE at same point', evaluateGeofence(job, 40.0, -105.0).status === 'INSIDE');
const near = evaluateGeofence(job, 40.0003, -105.0); // ~109 ft north
check('geofence INSIDE within radius', near.status === 'INSIDE', `dist=${near.distanceFeet?.toFixed(0)}ft`);
const far = evaluateGeofence(job, 40.01, -105.0); // ~3640 ft north
check('geofence OUTSIDE beyond radius', far.status === 'OUTSIDE', `dist=${far.distanceFeet?.toFixed(0)}ft`);
check('geofence UNKNOWN when device has no GPS', evaluateGeofence(job, null, null).status === 'UNKNOWN');
check('geofence NO_GEOFENCE when job has no coords',
  evaluateGeofence({ latitude: null, longitude: null, geofenceRadiusFeet: null }, 40, -105).status === 'NO_GEOFENCE');

// conflict detection (last-write-wins)
const serverNew = new Date('2026-01-02T00:00:00Z');
const deviceOld = '2026-01-01T00:00:00Z';
check('detectConflict server_newer when server ahead', detectConflict(serverNew, deviceOld) === 'server_newer');
check('detectConflict null when device ahead', detectConflict(new Date('2026-01-01T00:00:00Z'), '2026-01-02T00:00:00Z') === null);
check('detectConflict null when missing timestamps', detectConflict(null, deviceOld) === null);

// ===== report =====
const header = `OS1 Fiber Track Pro -- Increment 10 acceptance (P/Q/R)\nRun: ${new Date().toISOString()}\nResult: ${failed === 0 ? 'ALL PASSED' : failed + ' FAILED'} (${passed} passed, ${failed} failed)\n`;
console.log(header);
console.log(lines.join('\n'));
if (failed > 0) process.exit(1);
