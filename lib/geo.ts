// Geospatial helpers for geofencing (Increment 8).
// Distances are computed with the haversine formula and returned in feet to
// match the existing proximity model (ActivityLog.distanceFromJob is in feet).

export const DEFAULT_GEOFENCE_FEET = 500;
const EARTH_RADIUS_FEET = 20925524.9; // mean earth radius in feet

export function haversineFeet(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_FEET * c;
}

export function isInsideGeofence(
  pointLat: number,
  pointLng: number,
  centerLat: number,
  centerLng: number,
  radiusFeet: number = DEFAULT_GEOFENCE_FEET,
): boolean {
  return haversineFeet(pointLat, pointLng, centerLat, centerLng) <= radiusFeet;
}

// Age of a timestamp in seconds relative to now (never negative).
export function ageSeconds(ts: Date | string | null | undefined): number | null {
  if (!ts) return null;
  const t = typeof ts === 'string' ? new Date(ts) : ts;
  const ms = Date.now() - t.getTime();
  return Math.max(0, Math.round(ms / 1000));
}

// A vehicle/worker is considered STALE when telemetry stops updating.
export const STALE_AFTER_SECONDS = 300; // 5 minutes

export function isStale(ts: Date | string | null | undefined): boolean {
  const age = ageSeconds(ts);
  return age === null || age > STALE_AFTER_SECONDS;
}
