// Increment 10 — geofence evaluation for field evidence (R).
// Reuses the shared haversine model (feet) from lib/geo. GPS is mandatory in
// spirit but never rejected outright: when coordinates are missing we record
// UNKNOWN rather than blocking the submission (flag-not-reject).
import { haversineFeet, DEFAULT_GEOFENCE_FEET } from '@/lib/geo';

export type GeofenceStatus = 'INSIDE' | 'OUTSIDE' | 'UNKNOWN' | 'NO_GEOFENCE';

export interface GeofenceEvaluation {
  status: GeofenceStatus;
  distanceFeet: number | null;
}

export function evaluateGeofence(
  job: { latitude?: number | null; longitude?: number | null; geofenceRadiusFeet?: number | null },
  lat: number | null | undefined,
  lng: number | null | undefined
): GeofenceEvaluation {
  if (lat == null || lng == null) return { status: 'UNKNOWN', distanceFeet: null };
  if (job.latitude == null || job.longitude == null) return { status: 'NO_GEOFENCE', distanceFeet: null };
  const radius = job.geofenceRadiusFeet ?? DEFAULT_GEOFENCE_FEET;
  const distanceFeet = haversineFeet(lat, lng, job.latitude, job.longitude);
  return { status: distanceFeet <= radius ? 'INSIDE' : 'OUTSIDE', distanceFeet: Math.round(distanceFeet) };
}
