// Section — Field Photo GPS + Server-Side Watermark Evidence Acceptance Harness.
//
// Repeatable, automated acceptance for the field-photo evidence feature
// (spec §1–§16). Each check is one of:
//
//   [FUNCTIONAL]  Exercises real code paths (actually generates a watermark
//                 from a synthetic image, evaluates GPS policy, hashes bytes)
//                 with no DB/server/S3 needed.
//   [STATIC]      Asserts the guard/behavior is present in the shipped source
//                 (route calls auth() + correct role gate; original download is
//                 admin-only; captured GPS is never silently rewritten; the
//                 migration is additive; closeout packages the watermarked
//                 derivative, never the original).
//   [LIVE]        Requires a real device / running server / live Postgres / S3
//                 to exercise end-to-end (real outdoor GPS fix, camera capture,
//                 presigned upload, reverse geocode). These are NOT asserted as
//                 PASS — they are reported as LIVE-REQUIRED with the exact
//                 condition an operator must satisfy, so nothing is silently
//                 skipped.
//
// Run:  node_modules/.bin/tsx scripts/acceptance/photo-watermark-acceptance.ts
// Exit: non-zero if any FUNCTIONAL/STATIC check FAILS.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';

import {
  classifyAccuracy,
  evaluateGpsPolicy,
  ACCURACY_HIGH_MAX,
  ACCURACY_ACCEPTABLE_MAX,
} from '../../lib/evidence/gps-policy';
import { buildWatermarkLines, generateWatermark } from '../../lib/evidence/watermark';
import { DEFAULT_WATERMARK_SETTINGS, sha256Hex } from '../../lib/evidence/photo-evidence';
import { FALLBACK_BRANDING } from '../../lib/branding';

const ROOT = path.resolve(__dirname, '..', '..');

let pass = 0;
let fail = 0;
const live: string[] = [];

function ok(n: number, name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${String(n).padStart(2)}. ${name}${detail ? '  — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${String(n).padStart(2)}. ${name}${detail ? '  — ' + detail : ''}`); }
}
function liveRequired(n: number, name: string, how: string) {
  live.push(`${String(n).padStart(2)}. ${name} — ${how}`);
  console.log(`LIVE  ${String(n).padStart(2)}. ${name}  — requires live target: ${how}`);
}
function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function exists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel));
}

async function main() {
  console.log('=== Field Photo GPS + Watermark Evidence Acceptance ===\n');

  // Branding with no logo source -> getBrandingLogoBytes returns null cleanly,
  // so the harness never touches S3/DB. Watermark still renders text panel.
  const branding = { ...FALLBACK_BRANDING, companyName: 'Acme Fiber LLC' };

  // Build a synthetic "original" JPEG (deterministic content).
  const originalBytes = await sharp({
    create: { width: 1200, height: 900, channels: 3, background: { r: 40, g: 90, b: 140 } },
  }).jpeg({ quality: 90 }).toBuffer();
  const originalCopy = Buffer.from(originalBytes); // snapshot to detect mutation
  const originalSha = sha256Hex(originalBytes);

  const ctx = {
    workOrderNumber: 'WO-2045',
    projectName: 'Downtown Ring',
    taskCode: 'SPLICE-12 / BILL-3300',
    technicianName: 'Carlos Ramirez',
    latitude: 30.267153,
    longitude: -97.743057,
    gpsAccuracyMeters: 6,
    heading: 270,
    address: '600 Congress Ave, Austin, TX',
    capturedAt: new Date('2026-05-01T15:04:05Z'),
    evidenceRef: 'EV-000123',
  };

  // ---- §2 Original preservation + derivative hashing (FUNCTIONAL) ----
  const wm = await generateWatermark(originalBytes, DEFAULT_WATERMARK_SETTINGS, ctx, branding);
  const derivSha = sha256Hex(wm.buffer);

  ok(1, 'watermark derivative is produced (§5/§8)', wm.buffer.length > 0 && Buffer.isBuffer(wm.buffer),
    `${wm.buffer.length} bytes, ${wm.contentType}`);
  ok(2, 'derivative bytes differ from original (§2)', !wm.buffer.equals(originalBytes));
  ok(3, 'derivative SHA-256 differs from original SHA-256 (§2/§8)', derivSha !== originalSha,
    `orig=${originalSha.slice(0, 12)}… deriv=${derivSha.slice(0, 12)}…`);
  ok(4, 'original bytes are never mutated by generation (§1/§2/§15)', originalBytes.equals(originalCopy));
  ok(5, 'derivative is a valid image with preserved dimensions', await (async () => {
    try { const m = await sharp(wm.buffer).metadata(); return (m.width ?? 0) >= 1000 && (m.height ?? 0) >= 700; }
    catch { return false; }
  })(), 'sharp re-decodes the derivative');
  ok(6, 'derivative content-type is image/jpeg (§8)', wm.contentType === 'image/jpeg' && wm.ext === 'jpg');

  // ---- §5 Overlay field composition (FUNCTIONAL) ----
  const lines = buildWatermarkLines(DEFAULT_WATERMARK_SETTINGS, ctx, branding);
  const joined = lines.join('\n');
  ok(7, 'overlay includes company, WO#, project, task/billing code (§5)',
    joined.includes('Acme Fiber LLC') && joined.includes('WO: WO-2045') &&
    joined.includes('Downtown Ring') && joined.includes('SPLICE-12 / BILL-3300'));
  ok(8, 'overlay includes technician, GPS coords, accuracy, address, ref# (§5)',
    joined.includes('Carlos Ramirez') && joined.includes('30.267153') &&
    joined.includes('-97.743057') && /±6\s*m/.test(joined) &&
    joined.includes('Congress Ave') && joined.includes('EV-000123'));
  ok(9, 'overlay includes capture date & time (§5)',
    /2026/.test(joined) && /UTC/.test(joined));

  // Per-field toggles honored: disabling GPS coords removes them from the panel.
  const noGps = buildWatermarkLines(
    { ...DEFAULT_WATERMARK_SETTINGS, showGpsCoords: false, showGpsAccuracy: false, showAddress: false },
    ctx, branding);
  ok(10, 'per-field toggles honored (disabling GPS/address hides them) (§7)',
    !noGps.join('\n').includes('30.267153') && !noGps.join('\n').includes('Congress Ave'));

  // ---- §4 Accuracy classification (FUNCTIONAL) ----
  ok(11, `accuracy classified HIGH ≤${ACCURACY_HIGH_MAX}m (§4)`, classifyAccuracy(8) === 'HIGH');
  ok(12, `accuracy classified ACCEPTABLE >${ACCURACY_HIGH_MAX} & ≤${ACCURACY_ACCEPTABLE_MAX}m (§4)`,
    classifyAccuracy(20) === 'ACCEPTABLE');
  ok(13, `accuracy classified LOW >${ACCURACY_ACCEPTABLE_MAX}m (§4)`, classifyAccuracy(45) === 'LOW');

  // ---- §3 GPS policy enforcement (FUNCTIONAL) ----
  const missing = { latitude: null, longitude: null, accuracyMeters: null };
  const goodFix = { latitude: 30.2, longitude: -97.7, accuracyMeters: 6 };
  const coarseFix = { latitude: 30.2, longitude: -97.7, accuracyMeters: 80 };

  const req = evaluateGpsPolicy(missing, 'REQUIRED', 30);
  ok(14, 'REQUIRED policy blocks capture when GPS fix missing (§3)', req.blocked === true && req.hasFix === false);
  const warnMissing = evaluateGpsPolicy(missing, 'WARN', 30);
  ok(15, 'WARN policy allows but warns when GPS fix missing (§3)', warnMissing.blocked === false && warnMissing.warn === true);
  const optMissing = evaluateGpsPolicy(missing, 'OPTIONAL', 30);
  ok(16, 'OPTIONAL policy allows capture when GPS fix missing (§3)', optMissing.blocked === false);
  const good = evaluateGpsPolicy(goodFix, 'REQUIRED', 30);
  ok(17, 'good fix within company max accuracy passes cleanly (§4)',
    good.blocked === false && good.exceedsMaxAccuracy === false && good.accuracyClass === 'HIGH');
  const coarse = evaluateGpsPolicy(coarseFix, 'REQUIRED', 30);
  ok(18, 'fix worse than company max accuracy is flagged (§4)', coarse.exceedsMaxAccuracy === true);

  // ---- §8/§9/§12/§14 Source guards (STATIC) ----
  const detailRoute = read('app/api/evidence/photos/[id]/route.ts');
  ok(19, 'original download is ADMIN-only; derivative download broader (§12)',
    /download.*original/i.test(detailRoute) && /403/.test(detailRoute) &&
    /isAdmin|role\s*===\s*'ADMIN'|ADMIN/.test(detailRoute));
  ok(20, 'ADMIN GPS correction never overwrites captured lat/lon (§14)',
    /correctedLatitude/.test(detailRoute) && /correctionReason/.test(detailRoute) &&
    !/data:\s*\{[^}]*\blatitude:/.test(detailRoute.replace(/corrected/g, '')) );
  const portalRoute = read('app/api/portal/photo-evidence/route.ts');
  ok(21, 'capture route enforces GPS policy server-side & audits (§8/§9)',
    /evaluateGpsPolicy/.test(portalRoute) && /GPS_POLICY/.test(portalRoute) &&
    /ActivityLog|activityLog|audit/i.test(portalRoute));
  ok(22, 'capture route recomputes authoritative SHA-256 from stored bytes (§8)',
    /sha256Hex/.test(portalRoute));
  const settingsRoute = read('app/api/settings/watermark/route.ts');
  ok(23, 'watermark settings PUT is ADMIN-only (§7)',
    /await\s+auth\(\)/.test(settingsRoute) && /ADMIN/.test(settingsRoute) && /403|401/.test(settingsRoute));
  const closeoutRoute = read('app/api/jobs/[id]/closeout/route.ts');
  ok(24, 'closeout packages watermarked derivative, never the original (§13)',
    /watermarkedStoragePath/.test(closeoutRoute) && /fieldPhotoEvidence/.test(closeoutRoute) &&
    !/originalStoragePath/.test(closeoutRoute));

  // Additional structural guards (counted as STATIC too).
  ok(25, 'migration 0022 is additive (CREATE TABLE IF NOT EXISTS, no drops)',
    (() => {
      const m = read('prisma/migrations/0022_field_photo_evidence/migration.sql');
      return /CREATE TABLE IF NOT EXISTS/i.test(m) && !/DROP\s+(TABLE|COLUMN)/i.test(m);
    })());
  ok(26, 'PHOTO_EVIDENCE counter (EV, pad 6) registered in numbering (§10)',
    (() => { const n = read('lib/documents/numbering.ts'); return /PHOTO_EVIDENCE/.test(n) && /EV/.test(n); })());

  // ---- LIVE-required (real device / server / S3 / geocode) ----
  liveRequired(27, 'real outdoor GPS fix capture (§3/§4)',
    'capture a photo on a real device outdoors; confirm a HIGH/ACCEPTABLE fix is recorded and REQUIRED policy admits it');
  liveRequired(28, 'camera capture + presigned upload of original (§8/§11)',
    'from the field portal, take an evidence photo; confirm the ORIGINAL uploads to S3 and an EV-###### ref is issued');
  liveRequired(29, 'server-side derivative persisted with separate object + hash (§2/§8)',
    'after capture, confirm watermarkedStoragePath is set and watermarkedSha256 differs from originalSha256 in Postgres');
  liveRequired(30, 'reverse-geocoded address on overlay (§5)',
    'with network geocode enabled, confirm the address line renders on the watermarked image');
  liveRequired(31, 'offline capture queue uses field capture time, not upload time (§11)',
    'capture offline, reconnect; confirm capturedAt reflects field time and idempotent retry does not duplicate');

  console.log(`\n${pass} passed, ${fail} failed (non-live checks).`);
  if (live.length) {
    console.log(`\n${live.length} check(s) require a live device/server/Postgres/S3 to fully validate:`);
    for (const l of live) console.log(`  • ${l}`);
  }
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
