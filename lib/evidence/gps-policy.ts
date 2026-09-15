// GPS accuracy classification + capture policy enforcement for field photo
// evidence (spec §3, §4). Pure functions — safe to import on client or server.

export type AccuracyClass = 'HIGH' | 'ACCEPTABLE' | 'LOW';
export type GpsPolicy = 'REQUIRED' | 'WARN' | 'OPTIONAL';

// §4 accuracy bands (meters). HIGH <=10, ACCEPTABLE >10 & <=30, LOW >30.
export const ACCURACY_HIGH_MAX = 10;
export const ACCURACY_ACCEPTABLE_MAX = 30;

/** Classify a GPS accuracy reading (meters) into a quality band. */
export function classifyAccuracy(accuracyMeters: number | null | undefined): AccuracyClass | null {
  if (accuracyMeters == null || !Number.isFinite(accuracyMeters) || accuracyMeters < 0) return null;
  if (accuracyMeters <= ACCURACY_HIGH_MAX) return 'HIGH';
  if (accuracyMeters <= ACCURACY_ACCEPTABLE_MAX) return 'ACCEPTABLE';
  return 'LOW';
}

export interface GpsInput {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  accuracyMeters: number | null | undefined;
}

export interface PolicyDecision {
  hasFix: boolean;
  accuracyClass: AccuracyClass | null;
  // exceedsMaxAccuracy: reading is worse (larger meters) than company max.
  exceedsMaxAccuracy: boolean;
  // blocked: capture must be refused under the current policy.
  blocked: boolean;
  // warn: capture allowed but the tech should be warned.
  warn: boolean;
  message: string | null;
}

/**
 * Evaluate a GPS reading against the company policy. Never fabricates missing
 * data. `maxAccuracyMeters` is the company's max acceptable accuracy (e.g. 30).
 */
export function evaluateGpsPolicy(
  gps: GpsInput,
  policy: GpsPolicy,
  maxAccuracyMeters: number
): PolicyDecision {
  const hasFix =
    gps.latitude != null &&
    gps.longitude != null &&
    Number.isFinite(gps.latitude) &&
    Number.isFinite(gps.longitude);
  const accuracyClass = classifyAccuracy(gps.accuracyMeters);
  const acc = gps.accuracyMeters;
  const exceedsMaxAccuracy =
    acc != null && Number.isFinite(acc) && maxAccuracyMeters > 0 && acc > maxAccuracyMeters;

  if (!hasFix) {
    if (policy === 'REQUIRED') {
      return {
        hasFix,
        accuracyClass,
        exceedsMaxAccuracy,
        blocked: true,
        warn: false,
        message: 'LOCATION REQUIRED — enable GPS to capture evidence for this work order.',
      };
    }
    if (policy === 'WARN') {
      return {
        hasFix,
        accuracyClass,
        exceedsMaxAccuracy,
        blocked: false,
        warn: true,
        message: 'No GPS location captured. Evidence will be flagged as location-missing.',
      };
    }
    return { hasFix, accuracyClass, exceedsMaxAccuracy, blocked: false, warn: false, message: null };
  }

  // Has a fix but accuracy is poor.
  if (exceedsMaxAccuracy) {
    const accTxt = acc != null ? `${Math.round(acc)} m` : 'unknown';
    const msg = `GPS accuracy is currently ${accTxt}. Move outdoors or wait for a stronger signal (company requires \u2264 ${maxAccuracyMeters} m).`;
    if (policy === 'REQUIRED') {
      return { hasFix, accuracyClass, exceedsMaxAccuracy, blocked: true, warn: false, message: msg };
    }
    return { hasFix, accuracyClass, exceedsMaxAccuracy, blocked: false, warn: true, message: msg };
  }

  return { hasFix, accuracyClass, exceedsMaxAccuracy, blocked: false, warn: false, message: null };
}
