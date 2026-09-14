// Maintenance-Gate Acceptance Harness (final cold-review before live rehearsal).
//
// Proves the application maintenance gate is REAL (database-authoritative and
// request-enforced), not a host-only marker file, and that the self-host updater
// (scripts/os1-upgrade.sh + scripts/set-maintenance.mjs) drives it correctly and
// fail-closed. Pure request-gate logic is exercised FUNCTIONALLY by importing
// lib/maintenance.ts; the shell CLI is exercised by really running
// set-maintenance.mjs. Anything needing Docker/Postgres (a live 503 against a
// running server, a real DB toggle) is asserted statically and flagged LIVE-VM.
//
//   1  updater no longer treats the host-only MAINTENANCE file as authoritative
//   2  DB maintenanceMode is enabled BEFORE migrations
//   3  DB maintenanceMode is verified ON before migrations (read-back)
//   4  normal POST/PUT/PATCH/DELETE is rejected while ON (503, operator-safe body)
//   5  the health endpoint remains available during maintenance
//   6  the Update Center / recovery control plane remains available
//   7  a failed migration leaves maintenance ON
//   8  a failed cutover leaves maintenance ON
//   9  a failed health check leaves maintenance ON
//  10  a successful upgrade turns maintenance OFF
//  11  maintenance OFF is verified (read-back)
//  12  admin can recover without manual DB editing (UI toggle + shell helper)
//  13  no secrets are logged by the gate/updater helpers
//  14  live-VM enforcement is clearly identified
//  extra: pre-0018/0019 safety — column existence verified before depending on it
//         set-maintenance CLI is functional (usage/bad-arg rejected, DB reached)
//
// Run:  node_modules/.bin/tsx scripts/acceptance/maintenance-acceptance.ts
// Exit: non-zero if any check FAILS.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  isMutatingMethod,
  isRecoveryPath,
  isGatedRequest,
  MAINTENANCE_503_BODY,
} from '../../lib/maintenance';

let pass = 0;
let fail = 0;
let live = 0;
function ok(n: number, name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${String(n).padStart(2)}. ${name}${detail ? '  \u2014 ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${String(n).padStart(2)}. ${name}${detail ? '  \u2014 ' + detail : ''}`); }
}
function liveItem(n: number, name: string, test: string) {
  live++; console.log(`LIVE  ${String(n).padStart(2)}. ${name}  \u2014 ${test}`);
}

const ROOT = process.cwd();
function read(rel: string): string { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function exists(rel: string): boolean { return fs.existsSync(path.join(ROOT, rel)); }

const upgrade = read('scripts/os1-upgrade.sh');
const setMaint = read('scripts/set-maintenance.mjs');
const proxySrc = read('proxy.ts');
const libGate = read('lib/maintenance.ts');
const libState = read('lib/maintenance-state.ts');
const banner = read('components/maintenance-banner.tsx');

// --- 1. Updater does not treat the host-only marker as authoritative ---------
{
  const usesHelper = /run_maintenance\s+on/.test(upgrade) && /set-maintenance\.mjs/.test(upgrade);
  // The host marker may only appear annotated as SECONDARY evidence.
  const markerLines = upgrade.split('\n').filter((l) => /data\/updates\/MAINTENANCE/.test(l));
  const markerSecondaryOnly = markerLines.length > 0 &&
    markerLines.every((l) => /secondary evidence only/.test(l));
  ok(1, 'Updater drives the DB gate (set-maintenance.mjs); host marker is secondary evidence only',
    usesHelper && markerSecondaryOnly,
    `helper=${usesHelper} markerLines=${markerLines.length} secondaryOnly=${markerSecondaryOnly}`);
}

// --- 2. DB maintenance enabled BEFORE migrations -----------------------------
{
  const onIdx = upgrade.indexOf('run_maintenance on');
  const migIdx = upgrade.indexOf('Apply migrations from candidate image');
  ok(2, 'Maintenance is enabled before the migration step',
    onIdx > 0 && migIdx > 0 && onIdx < migIdx, `onIdx=${onIdx} migIdx=${migIdx}`);
}

// --- 3. Verified ON before migrations (read-back) ----------------------------
{
  const verifyOn = /MAINT_STATE"?\s*=\s*"on"/.test(upgrade) &&
    /refusing to migrate/.test(upgrade);
  const stopOnEnableFail = /could not enable DB maintenance gate before migrations \(STOP\)/.test(upgrade);
  // set-maintenance.mjs reads the value back and verifies it changed.
  const recorderVerifies = /verification failed: maintenanceMode/.test(setMaint);
  ok(3, 'Maintenance ON is verified before migrations (else STOP)',
    verifyOn && stopOnEnableFail && recorderVerifies,
    `verifyOn=${verifyOn} stop=${stopOnEnableFail} readback=${recorderVerifies}`);
}

// --- 4. Mutating product API rejected while ON (functional gate logic) --------
{
  const gatedPost = isGatedRequest('POST', '/api/jobs');
  const gatedPut = isGatedRequest('PUT', '/api/invoices/abc');
  const gatedPatch = isGatedRequest('PATCH', '/api/workers/1');
  const gatedDelete = isGatedRequest('DELETE', '/api/crews/9');
  const getNotGated = !isGatedRequest('GET', '/api/jobs');
  const methodSet = isMutatingMethod('post') && isMutatingMethod('DELETE') && !isMutatingMethod('GET');
  // Proxy returns 503 with the operator-safe body + Retry-After.
  const proxy503 = /status:\s*503/.test(proxySrc) &&
    /MAINTENANCE_503_BODY/.test(proxySrc) && /Retry-After/.test(proxySrc);
  const bodyShape = MAINTENANCE_503_BODY.error === 'System maintenance in progress';
  ok(4, 'Mutating product APIs are gated (503 "System maintenance in progress")',
    gatedPost && gatedPut && gatedPatch && gatedDelete && getNotGated && methodSet && proxy503 && bodyShape,
    `post=${gatedPost} put=${gatedPut} patch=${gatedPatch} del=${gatedDelete} getOpen=${getNotGated} 503=${proxy503}`);
}

// --- 5. Health endpoint stays available --------------------------------------
{
  const healthOpen = isRecoveryPath('/api/health') &&
    !isGatedRequest('POST', '/api/health') && !isGatedRequest('GET', '/api/health');
  ok(5, 'Health endpoint is never gated', healthOpen);
}

// --- 6. Update Center / recovery control plane stays available ----------------
{
  const updatesOpen = !isGatedRequest('POST', '/api/system/updates/maintenance') &&
    !isGatedRequest('POST', '/api/system/updates/install') &&
    !isGatedRequest('POST', '/api/system/updates/rollback');
  const authOpen = !isGatedRequest('POST', '/api/auth/callback/credentials') &&
    !isGatedRequest('POST', '/api/mfa/enroll/verify');
  // A non-recovery admin API is still gated (proves the allow-list is narrow).
  const devicesGated = isGatedRequest('POST', '/api/system/devices');
  ok(6, 'Recovery/update control plane open; unrelated admin APIs still gated',
    updatesOpen && authOpen && devicesGated,
    `updates=${updatesOpen} auth=${authOpen} devicesGated=${devicesGated}`);
}

// --- 7/8/9. Failures leave maintenance ON ------------------------------------
{
  // die() never turns maintenance off; the only 'run_maintenance off' is in the
  // finalize step, which is reached only after health + security pass.
  const dieBody = upgrade.slice(upgrade.indexOf('die() {'), upgrade.indexOf('die() {') + 400);
  const dieNoOff = !/run_maintenance\s+off/.test(dieBody);
  const offCount = (upgrade.match(/run_maintenance\s+off/g) || []).length;
  const offIdx = upgrade.indexOf('run_maintenance off');
  const healthIdx = upgrade.indexOf('Health check');
  const finalizeIdx = upgrade.indexOf('Exit maintenance / prune candidates');
  const offOnlyAtFinalize = offCount === 1 && offIdx > healthIdx && offIdx > finalizeIdx - 1;
  ok(7, 'Failed migration leaves maintenance ON (die never disables it)', dieNoOff && offOnlyAtFinalize);
  ok(8, 'Failed cutover leaves maintenance ON (off only after health+security pass)', offOnlyAtFinalize);
  const healthFailKeepsOn = /health check failed after migration[\s\S]*?maintenance held ON/.test(upgrade);
  ok(9, 'Failed health check leaves maintenance ON', dieNoOff && healthFailKeepsOn);
}

// --- 10/11. Success turns OFF and verifies -----------------------------------
{
  const turnsOff = /run_maintenance off/.test(upgrade);
  const verifyOff = /MAINT_STATE"?\s*=\s*"off"/.test(upgrade) &&
    /maintenance gate not confirmed OFF/.test(upgrade);
  ok(10, 'Successful upgrade turns maintenance OFF', turnsOff);
  ok(11, 'Maintenance OFF is verified (read-back, else STOP)', verifyOff);
}

// --- 12. Admin can recover without manual DB editing --------------------------
{
  const uiRoute = exists('app/api/system/updates/maintenance/route.ts');
  const shellHelper = /set-maintenance\.mjs/.test(upgrade) && exists('scripts/set-maintenance.mjs');
  ok(12, 'Admin recovery without manual DB edits (Update Center toggle + shell helper)',
    uiRoute && shellHelper, `uiRoute=${uiRoute} shellHelper=${shellHelper}`);
}

// --- 13. No secrets logged ---------------------------------------------------
{
  // The gate reader fails closed on the boolean only and never prints secrets.
  const stateNoLeak = !/console\.log|process\.stdout/.test(libState);
  // set-maintenance only ever writes 'on'/'off'/usage/errors — no env dumps.
  const cliNoEnvDump = !/process\.env/.test(setMaint) && !/JSON\.stringify\(process/.test(setMaint);
  // run_maintenance passes only the image tag + build sha, no secret env.
  const rm = upgrade.slice(upgrade.indexOf('run_maintenance() {'), upgrade.indexOf('run_maintenance() {') + 1200);
  const rmNoSecretEnv = /CONTRACTOR_APP_IMAGE="\$CANDIDATE_TAG" APP_BUILD_SHA="\$TARGET_SHA"/.test(rm) &&
    !/(PASSWORD|TOKEN|SECRET|DATABASE_URL)=/.test(rm);
  ok(13, 'Gate/updater helpers never log secrets',
    stateNoLeak && cliNoEnvDump && rmNoSecretEnv,
    `stateNoLeak=${stateNoLeak} cliNoEnvDump=${cliNoEnvDump} rmNoSecretEnv=${rmNoSecretEnv}`);
}

// --- extra: pre-0018/0019 safety (column existence verified) ------------------
{
  const reachFirst = /SELECT 1/.test(setMaint) && /database not reachable/.test(setMaint);
  const columnCheck = /SELECT "maintenanceMode" FROM "UpdateSettings"/.test(setMaint) &&
    /schema too old/.test(setMaint);
  ok(15, 'Pre-migration safety: DB reachability then maintenanceMode column verified before use',
    reachFirst && columnCheck, `reach=${reachFirst} column=${columnCheck}`);
}

// --- extra: set-maintenance CLI is functional --------------------------------
{
  const noArg = spawnSync('node', ['scripts/set-maintenance.mjs'], { cwd: ROOT, encoding: 'utf8' });
  const badArg = spawnSync('node', ['scripts/set-maintenance.mjs', 'frobnicate'], { cwd: ROOT, encoding: 'utf8' });
  const onNoDb = spawnSync('node', ['scripts/set-maintenance.mjs', 'on'], { cwd: ROOT, encoding: 'utf8', timeout: 25000 });
  const noArgRej = noArg.status === 1;
  const badArgRej = badArg.status === 1 && /usage:/.test(badArg.stderr || '');
  // Without a DB in this VM the 'on' path must reach the DB layer and fail there
  // (proving the toggle is wired), not crash earlier.
  const onReachesDb = onNoDb.status !== 0 &&
    /database not reachable|prisma/i.test((onNoDb.stderr || '') + (onNoDb.stdout || ''));
  ok(16, 'set-maintenance CLI rejects bad usage and wires the DB toggle (real toggle is live-VM)',
    noArgRej && badArgRej && onReachesDb,
    `noArg=${noArgRej} badArg=${badArgRej} onReachesDb=${onReachesDb}`);
}

// --- banner present ----------------------------------------------------------
{
  const bannerWired = /MaintenanceBanner/.test(read('app/layout.tsx')) &&
    /System Maintenance/.test(banner) && /isMaintenanceActive/.test(banner);
  ok(17, 'Server-rendered maintenance notice is wired into the root layout', bannerWired);
}

// --- proxy scope + runtime ---------------------------------------------------
{
  // Next 16 proxy always runs on Node.js runtime (so Prisma is usable) and must
  // NOT declare a runtime; matcher is scoped to /api/*.
  const noRuntimeCfg = !/runtime\s*:/.test(proxySrc);
  const apiMatcher = /matcher:\s*\['\/api\/:path\*'\]/.test(proxySrc);
  const namedExport = /export async function proxy/.test(proxySrc);
  ok(18, 'Proxy is Node-runtime (no runtime override), API-scoped, named-export',
    noRuntimeCfg && apiMatcher && namedExport,
    `noRuntimeCfg=${noRuntimeCfg} matcher=${apiMatcher} named=${namedExport}`);
}

// --- LIVE-VM enforcement -----------------------------------------------------
liveItem(1, 'Live 503 enforcement',
  'On live VM: with maintenanceMode=ON, a POST/PUT/PATCH/DELETE to an ordinary product API (e.g. POST /api/jobs) MUST return HTTP 503 {"error":"System maintenance in progress"}, while GET succeeds.');
liveItem(2, 'Live recovery reachability',
  'On live VM: with maintenanceMode=ON, /api/health, credential login (/api/auth), and the Update Center maintenance toggle (/api/system/updates/maintenance) MUST still work so an admin can recover.');
liveItem(3, 'Live DB toggle + verify',
  'On live VM w/ Postgres: `docker compose run --rm --entrypoint node app scripts/set-maintenance.mjs on` sets UpdateSettings.maintenanceMode=true and prints "on"; `... off` prints "off"; both read back the value.');
liveItem(4, 'Live upgrade window',
  'On live VM: a full os1-upgrade run enables maintenance before migrations, holds it ON through migrate/cutover/health/security, and turns it OFF (verified) only after all pass; any failure leaves it ON.');

console.log(`\n=== Maintenance-Gate Acceptance: ${pass} passed, ${fail} failed, ${live} live-VM ===`);
process.exit(fail === 0 ? 0 : 1);
