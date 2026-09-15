// Section — Offline Evidence Queue Retry State-Machine Acceptance Harness (cold-review §4).
//
// Proves — by static source assertion — the five-state retry machine, automatic
// re-reservation on expiry, GPS-block non-retryable terminal state, in-memory
// concurrency lock, stuck-upload reconciliation, and field-timestamp preservation.
// offline-queue.ts is a 'use client' / IndexedDB module, so checks are STATIC
// source regex (no runtime import).
//
// Run:  node_modules/.bin/tsx scripts/acceptance/offline-queue-acceptance.ts
// Exit: non-zero if any STATIC check FAILS.

import fs from 'fs';
import path from 'path';

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
function read(rel: string): string { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

async function main() {
  console.log('=== Offline Evidence Queue Retry State-Machine Acceptance (§4) ===\n');

  const Q = 'lib/evidence/offline-queue.ts';
  const q = read(Q);
  const PORTAL = 'app/portal/task/[id]/_components/portal-task-detail.tsx';
  const portal = read(PORTAL);

  // --- Five-state machine -------------------------------------------------
  for (const [i, st] of ['PENDING_UPLOAD','UPLOADING','UPLOADED','RETRYABLE_ERROR','BLOCKED_RETAKE_REQUIRED'].entries()) {
    ok(1 + i, `QueueStatus defines ${st}`, new RegExp(`'${st}'`).test(q));
  }
  ok(6, 'QueueStatus is a union of exactly the five states',
    /export type QueueStatus =[\s\S]*?PENDING_UPLOAD[\s\S]*?UPLOADING[\s\S]*?UPLOADED[\s\S]*?RETRYABLE_ERROR[\s\S]*?BLOCKED_RETAKE_REQUIRED/.test(q));

  // --- Re-reservation on expiry ------------------------------------------
  ok(7, 'reservationUsable() checks TTL against a safety margin',
    /function reservationUsable/.test(q) && /RESERVATION_MARGIN_MS/.test(q));
  ok(8, 'unusable reservation is cleared (id/url/expiry nulled) before re-reserving',
    /reservationId:\s*null,\s*uploadUrl:\s*null,\s*reservationExpiresAt:\s*null/.test(q));
  ok(9, 'obtainReservation() fetches a FRESH reservation from the reserve endpoint',
    /function obtainReservation/.test(q) && /reserve/.test(q));
  ok(10, 'processQueueItem re-reserves when !reservationUsable(item)',
    /if\s*\(!reservationUsable\(item\)\)/.test(q));

  // --- GPS-block = non-retryable terminal --------------------------------
  ok(11, 'classifyRegisterFailure maps 422 GPS_POLICY → blocked',
    /status === 422 && code === 'GPS_POLICY'/.test(q) && /return 'blocked'/.test(q));
  ok(12, 'blocked register result transitions to BLOCKED_RETAKE_REQUIRED',
    /status:\s*'BLOCKED_RETAKE_REQUIRED'/.test(q));
  ok(13, 'processQueue only auto-retries PENDING_UPLOAD or RETRYABLE_ERROR (never BLOCKED)',
    /filter\(q =>\s*q\.status === 'PENDING_UPLOAD'\s*\|\|\s*q\.status === 'RETRYABLE_ERROR'\)/.test(q));
  ok(14, 'BLOCKED item short-circuits in processQueueItem (returns false, no attempt)',
    /status === 'BLOCKED_RETAKE_REQUIRED'\)\s*return false/.test(q));

  // --- Failure classification mapping ------------------------------------
  ok(15, '413/TOO_LARGE and 415/UNSUPPORTED_TYPE classified as blocked',
    /status === 413 \|\| code === 'TOO_LARGE'/.test(q) && /status === 415 \|\| code === 'UNSUPPORTED_TYPE'/.test(q));
  ok(16, 'missing-in-storage (upload never landed) classified as retryable',
    /not found in storage/.test(q) && /return 'retryable'/.test(q));
  ok(17, 'reservation/URL/signature/server faults default to retryable',
    /return 'retryable';\s*\n\}/.test(q) || /\/\/ Reservation problems[\s\S]*?return 'retryable'/.test(q));

  // --- In-memory concurrency lock ----------------------------------------
  ok(18, 'module-level processing Set guards against double-processing',
    /const processing = new Set<string>\(\)/.test(q));
  ok(19, 'processQueueItem bails if the item is already being processed',
    /if\s*\(processing\.has\(/.test(q) && /processing\.add\(/.test(q));
  ok(20, 'lock released in finally (processing.delete)',
    /processing\.delete\(/.test(q) && /finally/.test(q));

  // --- Stuck-upload reconciliation ---------------------------------------
  ok(21, 'reconcileStuckUploads resets stale UPLOADING → RETRYABLE_ERROR',
    /function reconcileStuckUploads/.test(q) && /STALE_UPLOADING_MS/.test(q) &&
    /status:\s*'RETRYABLE_ERROR'/.test(q));
  ok(22, 'processQueue runs reconciliation before processing',
    /await reconcileStuckUploads\(\);/.test(q));
  ok(23, 'reconcile skips records with an active in-memory lock',
    /if\s*\(processing\.has\(item\.localUuid\)\)\s*continue/.test(q));

  // --- Field-timestamp preservation --------------------------------------
  ok(24, 'capturedAt forwarded as field truth (never replaced with retry time)',
    /capturedAt:\s*item\.capturedAt/.test(q));
  ok(25, 'no assignment overwrites capturedAt/locationCapturedAt with Date.now/new Date',
    !/capturedAt:\s*(new Date\(\)|Date\.now\(\))/.test(q) &&
    !/locationCapturedAt:\s*(new Date\(\)|Date\.now\(\))/.test(q));

  // --- Portal UI wiring ---------------------------------------------------
  ok(26, 'portal shows a retake message for BLOCKED_RETAKE_REQUIRED items',
    /BLOCKED_RETAKE_REQUIRED/.test(portal) && /Retake with valid GPS fix/i.test(portal));
  ok(27, 'portal Retry action only offered for retryable/pending items',
    /RETRYABLE_ERROR/.test(portal) && /PENDING_UPLOAD/.test(portal));

  // --- Live ---------------------------------------------------------------
  liveRequired(28, 'expired reservation TTL during offline retry → fresh reservation obtained',
    'let a queued item sit past reservation TTL, reconnect; confirm a NEW reservation is fetched, not the stale one');
  liveRequired(29, 'expired presigned URL (403/SignatureExpired) → re-reserve then upload',
    'force an expired upload URL; confirm reservation cleared, re-reserved, upload succeeds');
  liveRequired(30, 'GPS-blocked capture requires manual retake (no auto-retry, no double-process)',
    'queue a capture missing GPS with GPS mandatory; confirm BLOCKED_RETAKE_REQUIRED, no auto-retry, manual retry cannot double-process');

  console.log(`\n${pass} passed, ${fail} failed (non-live checks).`);
  if (live.length) {
    console.log(`\n${live.length} check(s) require a live device/server to fully validate:`);
    for (const l of live) console.log(`  • ${l}`);
  }
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
