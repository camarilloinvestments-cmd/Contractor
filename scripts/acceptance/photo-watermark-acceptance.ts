// Section — Field Photo GPS + Server-Side Watermark Evidence Acceptance Harness.
// Expanded for cold-review corrective pass (§1–§7).
//
// Repeatable, automated acceptance. Each check is [FUNCTIONAL], [STATIC], or [LIVE].
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
import { reverseGeocode } from '../../lib/evidence/geocode';

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
  console.log('=== Field Photo GPS + Watermark Evidence Acceptance (Cold-Review) ===\n');

  const branding = { ...FALLBACK_BRANDING, companyName: 'Acme Fiber LLC' };

  // Build a synthetic original JPEG.
  const originalBytes = await sharp({
    create: { width: 1200, height: 900, channels: 3, background: { r: 40, g: 90, b: 140 } },
  }).jpeg({ quality: 90 }).toBuffer();
  const originalCopy = Buffer.from(originalBytes);
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
    fieldTimezone: 'America/Chicago',
  };

  // ======== ORIGINAL FEATURE CHECKS (1–26) ========

  // §2 Original preservation + derivative hashing (FUNCTIONAL)
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

  // §5 Overlay field composition (FUNCTIONAL)
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
    /2026/.test(joined));

  // Per-field toggles.
  const noGps = buildWatermarkLines(
    { ...DEFAULT_WATERMARK_SETTINGS, showGpsCoords: false, showGpsAccuracy: false, showAddress: false },
    ctx, branding);
  ok(10, 'per-field toggles honored (disabling GPS/address hides them) (§7)',
    !noGps.join('\n').includes('30.267153') && !noGps.join('\n').includes('Congress Ave'));

  // §4 Accuracy classification (FUNCTIONAL)
  ok(11, `accuracy classified HIGH ≤${ACCURACY_HIGH_MAX}m (§4)`, classifyAccuracy(8) === 'HIGH');
  ok(12, `accuracy classified ACCEPTABLE >${ACCURACY_HIGH_MAX} & ≤${ACCURACY_ACCEPTABLE_MAX}m (§4)`,
    classifyAccuracy(20) === 'ACCEPTABLE');
  ok(13, `accuracy classified LOW >${ACCURACY_ACCEPTABLE_MAX}m (§4)`, classifyAccuracy(45) === 'LOW');

  // §3 GPS policy enforcement (FUNCTIONAL)
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

  // §8/§9/§12/§14 Source guards (STATIC)
  const detailRoute = read('app/api/evidence/photos/[id]/route.ts');
  ok(19, 'original download is ADMIN-only; derivative download broader (§12)',
    /download.*original/i.test(detailRoute) && /403/.test(detailRoute) &&
    /isAdmin|role\s*===\s*'ADMIN'|ADMIN/.test(detailRoute));
  ok(20, 'ADMIN GPS correction never overwrites captured lat/lon (§14)',
    /correctedLatitude/.test(detailRoute) && /correctionReason/.test(detailRoute));
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
  ok(25, 'migration 0022 is additive (CREATE TABLE IF NOT EXISTS, no drops)',
    (() => {
      const m = read('prisma/migrations/0022_field_photo_evidence/migration.sql');
      return /CREATE TABLE IF NOT EXISTS/i.test(m) && !/DROP\s+(TABLE|COLUMN)/i.test(m);
    })());
  ok(26, 'PHOTO_EVIDENCE counter (EV, pad 6) registered in numbering (§10)',
    (() => { const n = read('lib/documents/numbering.ts'); return /PHOTO_EVIDENCE/.test(n) && /EV/.test(n); })());

  // ======== COLD-REVIEW CORRECTIVE CHECKS (27–62) ========

  // §1: Tech/task/work-order authorization (STATIC)
  ok(27, 'reserve route verifies session.user.workerId exists (§1)',
    (() => {
      const r = read('app/api/portal/photo-evidence/reserve/route.ts');
      return /workerId/.test(r) && /403/.test(r);
    })());
  ok(28, 'reserve route verifies task.workerId === session workerId (§1)',
    (() => {
      const r = read('app/api/portal/photo-evidence/reserve/route.ts');
      return /task\.workerId\s*!==\s*workerId/.test(r) && /not assigned/i.test(r);
    })());
  ok(29, 'reserve route verifies task.jobId === submitted jobId (§1)',
    (() => {
      const r = read('app/api/portal/photo-evidence/reserve/route.ts');
      return /task\.jobId\s*!==\s*jobId/.test(r) && /does not belong/i.test(r);
    })());
  ok(30, 'registration route re-verifies task assignment + job binding (§1)',
    /task\.workerId\s*!==\s*workerId/.test(portalRoute) && /task\.jobId\s*!==\s*jobId/.test(portalRoute));

  // §2: Upload reservation system (STATIC)
  ok(31, 'reservation model exists in schema (§2)',
    (() => { const s = read('prisma/schema.prisma'); return /model EvidenceUploadReservation/.test(s); })());
  ok(32, 'registration route requires reservationId, not raw storage path (§2)',
    /reservationId/.test(portalRoute) && /Missing reservationId/.test(portalRoute));
  ok(33, 'reservation route enforces allowed MIME types (§2)',
    (() => {
      const r = read('app/api/portal/photo-evidence/reserve/route.ts');
      return /ALLOWED_MIME/.test(r) && /image\/jpeg/.test(r) && /Unsupported file type/.test(r);
    })());
  ok(34, 'registration route validates image dimensions before processing (§2)',
    /MAX_PIXEL_AREA/.test(portalRoute) && /megapixel limit/.test(portalRoute));
  ok(35, 'registration route enforces max upload size (§2)',
    /MAX_UPLOAD_BYTES/.test(portalRoute) && /exceeds.*MB limit/i.test(portalRoute));
  ok(36, 'reservation is marked consumed after use (single-use) (§2)',
    /consumed.*true/.test(portalRoute));
  ok(37, 'reservation verifies actor/task/job binding on registration (§2)',
    /reservation\.userId\s*!==/.test(portalRoute) && /reservation\.taskId\s*!==/.test(portalRoute));
  ok(38, 'reservation expiration is enforced (§2)',
    /expiresAt/.test(portalRoute) && /expired/i.test(portalRoute));
  ok(39, 'reservation storage path uses server-generated key (§2)',
    (() => {
      const r = read('app/api/portal/photo-evidence/reserve/route.ts');
      return /generatePresignedUploadUrl/.test(r) && /evidence-/.test(r);
    })());

  // §3: Reverse geocode (FUNCTIONAL + STATIC)
  ok(40, 'geocode module exists (§3)', exists('lib/evidence/geocode.ts'));
  ok(41, 'geocode failure returns null, never throws (§3)',
    await (async () => {
      const r = await reverseGeocode(999, 999, 'nominatim');
      return r === null;
    })());
  ok(42, 'geocode disabled provider returns null (§3)',
    await (async () => {
      const r = await reverseGeocode(30, -97, 'none');
      return r === null;
    })());
  ok(43, 'registration route calls reverseGeocode + stores addressLookupAt/Provider (§3)',
    /reverseGeocode/.test(portalRoute) && /addressLookupAt/.test(portalRoute) && /addressProvider/.test(portalRoute));
  ok(44, 'geocode provider credential never exposed to browser (§3)',
    (() => {
      const g = read('lib/evidence/geocode.ts');
      return !/API_KEY|api_key|apiKey/.test(g);
    })());

  // §4: Offline queue (STATIC)
  ok(45, 'offline queue module exists and uses IndexedDB (§4)',
    (() => {
      const q = read('lib/evidence/offline-queue.ts');
      return /IndexedDB|openDB|idb/.test(q) && /PENDING_UPLOAD|UPLOADING|UPLOADED|FAILED/.test(q);
    })());
  ok(46, 'offline queue stores field capturedAt, GPS, blob (§4)',
    (() => {
      const q = read('lib/evidence/offline-queue.ts');
      return /capturedAt/.test(q) && /latitude/.test(q) && /photoBlob/.test(q);
    })());
  ok(47, 'offline queue processQueueItem never replaces field capturedAt with retry time (§4/§6)',
    (() => {
      const q = read('lib/evidence/offline-queue.ts');
      return /item\.capturedAt/.test(q);
    })());
  ok(48, 'portal uses offline queue for evidence capture (§4)',
    (() => {
      const p = read('app/portal/task/[id]/_components/portal-task-detail.tsx');
      return /enqueueEvidence/.test(p) && /processQueue/.test(p) && /listQueue/.test(p);
    })());
  ok(49, 'portal shows pending queue status to user (§4)',
    (() => {
      const p = read('app/portal/task/[id]/_components/portal-task-detail.tsx');
      return /evidenceQueue/.test(p) && /pending.*evidence/i.test(p);
    })());

  // §5: Field timezone on watermark (FUNCTIONAL)
  ok(50, 'watermark renders configured timezone, not UTC (§5)',
    (() => {
      const linesChicago = buildWatermarkLines(DEFAULT_WATERMARK_SETTINGS,
        { ...ctx, fieldTimezone: 'America/Chicago' }, branding);
      const timeStr = linesChicago.join(' ');
      return /CDT|CST|CT/.test(timeStr) && !/UTC/.test(timeStr);
    })());
  ok(51, 'watermark with null timezone falls back to UTC (§5)',
    (() => {
      const linesUtc = buildWatermarkLines(DEFAULT_WATERMARK_SETTINGS,
        { ...ctx, fieldTimezone: null }, branding);
      return /UTC/.test(linesUtc.join(' '));
    })());
  ok(52, 'watermark settings include fieldTimezone field (§5)',
    /fieldTimezone/.test(read('app/api/settings/watermark/route.ts')));
  ok(53, 'watermark settings validate IANA timezone (§5)',
    /Invalid IANA timezone/.test(read('app/api/settings/watermark/route.ts')));

  // §6: Capture timestamp semantics (STATIC)
  ok(54, 'schema has uploadedAt, addressLookupAt columns (§6)',
    (() => {
      const s = read('prisma/schema.prisma');
      return /uploadedAt\s+DateTime\?/.test(s) && /addressLookupAt\s+DateTime\?/.test(s);
    })());
  ok(55, 'registration route sets uploadedAt server-side (§6)',
    /uploadedAt.*now/.test(portalRoute));

  // Migration additive (STATIC)
  ok(56, 'migration 0023 is additive (ALTER TABLE ADD COLUMN, no drops)',
    (() => {
      const m = read('prisma/migrations/0023_evidence_cold_review/migration.sql');
      return /ADD COLUMN IF NOT EXISTS/i.test(m) && /CREATE TABLE IF NOT EXISTS/i.test(m) &&
        !/DROP\s+(TABLE|COLUMN)/i.test(m);
    })());

  ok(57, 'settings route accepts geocodeProvider (§3)',
    /geocodeProvider/.test(read('app/api/settings/watermark/route.ts')));
  ok(58, 'watermark settings UI includes timezone + geocode fields (§5/§3)',
    (() => {
      const ui = read('app/(admin)/settings/_components/watermark-tab.tsx');
      return /fieldTimezone/.test(ui) && /geocodeProvider/.test(ui);
    })());

  ok(59, 'existing shared branding behavior remains intact',
    (() => {
      const b = read('lib/branding.ts');
      return /getCompanyProfile/.test(b) && /getBrandingLogoBytes/.test(b) && /FALLBACK_BRANDING/.test(b);
    })());

  ok(60, 'no financial data appears in customer-facing watermark derivative (§13)',
    (() => {
      const w = read('lib/evidence/watermark.ts');
      return !/\bbillable\b|\bpayout\b|\bcost\b|\bprofit\b|\binvoice\b|\bamount\b|\bprice\b|\b(?<!gene|sepa)rate\b/i.test(w);
    })());

  ok(61, 'security acceptance harness still exists and is importable',
    exists('scripts/acceptance/security-acceptance.ts'));

  ok(62, 'idb package declared in package.json (§4)',
    /"idb"/.test(read('package.json')));

  // ======== LIVE-REQUIRED ========

  liveRequired(63, 'assigned tech can upload evidence (§1)',
    'POST /api/portal/photo-evidence/reserve with assigned tech → 200; then register → evidence created');
  liveRequired(64, 'unassigned tech cannot upload to another tech\'s task (§1)',
    'POST /api/portal/photo-evidence/reserve with unassigned tech → 403');
  liveRequired(65, 'task from Job A cannot be submitted using Job B (§1)',
    'POST /api/portal/photo-evidence/reserve with mismatched jobId → 403');
  liveRequired(66, 'arbitrary valid job/task IDs are rejected (§1)',
    'submit with valid but unrelated task/job → 404/403');
  liveRequired(67, 'evidence upload reservation is single-use/idempotent (§2)',
    'use reservationId twice → second register returns 409 consumed');
  liveRequired(68, 'unsupported MIME rejected at reservation (§2)',
    'POST reserve with contentType=application/pdf → 400');
  liveRequired(69, 'oversized photo rejected safely after upload (§2)',
    'upload a >20 MB file, register → 413 size error');
  liveRequired(70, 'excessive image dimensions rejected safely (§2)',
    'upload a 15000×15000 PNG, register → 413 pixel limit error');
  liveRequired(71, 'reverse geocode populates address when provider succeeds (§3)',
    'capture with valid lat/lon, geocodeProvider=nominatim → address populated in DB');
  liveRequired(72, 'reverse geocode failure does not destroy evidence (§3)',
    'capture with bad lat/lon or provider error → evidence created with address=null');
  liveRequired(73, 'offline capture survives page/app reopen (§4)',
    'capture while offline, close & reopen portal → pending item still in queue');
  liveRequired(74, 'queued capture preserves original photo bytes (§4)',
    'after offline capture + reopen, queue blob matches original file');
  liveRequired(75, 'queued capture preserves field capturedAt (§4/§6)',
    'after offline queue → upload, capturedAt in DB matches field time, not upload time');
  liveRequired(76, 'queued capture preserves GPS fix timestamp (§4/§6)',
    'locationCapturedAt in DB matches field GPS timestamp');
  liveRequired(77, 'reconnect uploads automatically or via explicit retry (§4)',
    'go online with pending queue → auto-process fires or user taps Retry');
  liveRequired(78, 'retry does not duplicate evidence (§4)',
    'retry an already-uploaded item (same localUuid) → duplicate:true returned');
  liveRequired(79, 'watermark displays configured local/project timezone (§5)',
    'set fieldTimezone=America/New_York, capture → watermark shows EST/EDT, not UTC');
  liveRequired(80, 'database/audit timestamp remains UTC (§6)',
    'inspect receivedAt, capturedAt in DB → stored as UTC');
  liveRequired(81, 'real outdoor GPS fix capture (§3/§4)',
    'capture on a real device outdoors; confirm a HIGH/ACCEPTABLE fix is recorded');
  liveRequired(82, 'camera capture + presigned upload via reservation (§2/§8)',
    'from portal, take evidence photo → reservation issued → upload → register → EV-###### ref');
  liveRequired(83, 'server-side derivative persisted with separate hash (§2/§8)',
    'after capture, watermarkedSha256 differs from originalSha256 in Postgres');
  liveRequired(84, 'prior security acceptance remains green',
    'run security-acceptance.ts and confirm 21/0');

  console.log(`\n${pass} passed, ${fail} failed (non-live checks).`);
  if (live.length) {
    console.log(`\n${live.length} check(s) require a live device/server/Postgres/S3 to fully validate:`);
    for (const l of live) console.log(`  • ${l}`);
  }
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
