// Section — Atomic Evidence Reservation Consumption Acceptance Harness (cold-review §2).
//
// Proves — by static source assertion — that a single reservation can be
// consumed AT MOST ONCE, that consumption and evidence creation commit/rollback
// together, and that a lost HTTP response is idempotently recoverable.
//
// Run:  node_modules/.bin/tsx scripts/acceptance/reservation-concurrency-acceptance.ts
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
function exists(rel: string): boolean { return fs.existsSync(path.join(ROOT, rel)); }

async function main() {
  console.log('=== Atomic Evidence Reservation Consumption Acceptance (§2) ===\n');

  const ROUTE = 'app/api/portal/photo-evidence/route.ts';
  const route = read(ROUTE);
  const schema = read('prisma/schema.prisma');

  // --- Atomic claim inside a transaction ---------------------------------
  ok(1, 'POST handler wraps consumption in prisma.$transaction',
    /\$transaction\(async \(tx\)\s*=>/.test(route));

  ok(2, 'reservation claimed via conditional updateMany (not read-then-write)',
    /tx\.evidenceUploadReservation\.updateMany\(/.test(route));

  ok(3, 'claim predicate requires consumed:false AND unexpired',
    /consumed:\s*false/.test(route) && /expiresAt:\s*\{\s*gt:/.test(route));

  ok(4, 'claim scoped to the owning worker/task/job (no cross-tenant claim)',
    /workerId/.test(route) && /taskId/.test(route) && /jobId/.test(route) && /userId/.test(route));

  ok(5, 'claim sets consumed:true and records consumedAt in the same write',
    /data:\s*\{\s*consumed:\s*true,\s*consumedAt/.test(route));

  ok(6, 'exactly-one-row guard: count !== 1 rejects the claim',
    /claim\.count\s*!==\s*1/.test(route) && /ReservationClaimError/.test(route));

  // --- Same-transaction evidence creation --------------------------------
  ok(7, 'evidence number allocated inside the transaction (tx-aware)',
    /allocateNumber\(\s*'PHOTO_EVIDENCE',\s*tx\s*\)/.test(route));

  ok(8, 'evidence row created on the transaction client (tx.fieldPhotoEvidence.create)',
    /tx\.fieldPhotoEvidence\.create\(/.test(route));

  ok(9, 'reservation back-linked to the created evidence id in the same tx',
    /tx\.evidenceUploadReservation\.update\(/.test(route) && /evidenceId:\s*rec\.id/.test(route));

  // --- Rollback semantics -------------------------------------------------
  // Because claim + allocate + create + back-link all run on `tx`, any throw
  // rolls the whole transaction back — the reservation is NOT left consumed.
  ok(10, 'claim + allocate + create + back-link all execute on the tx client',
    /tx\.evidenceUploadReservation\.updateMany/.test(route) &&
    /tx\.fieldPhotoEvidence\.create/.test(route) &&
    /tx\.evidenceUploadReservation\.update/.test(route));

  ok(11, 'no non-tx pre-consumption of the reservation before the transaction',
    !/prisma\.evidenceUploadReservation\.update(Many)?\(/.test(route));

  // --- P2002 handling -----------------------------------------------------
  ok(12, 'duplicate localUuid inside tx surfaces as DuplicateLocalUuidError',
    /DuplicateLocalUuidError/.test(route) &&
    /includes\('localUuid'\)/.test(route));

  ok(13, 'P2002 on evidence ref retries the WHOLE transaction (Postgres taint-safe)',
    /code === 'P2002'/.test(route) && /continue;/.test(route));

  ok(14, 'bounded retry loop (does not spin forever)',
    /for\s*\(let attempt/.test(route) || /attempt\s*<\s*\d/.test(route) || /attempts?\s*<=?\s*\d/.test(route));

  // --- Lost-response idempotency -----------------------------------------
  ok(15, 'pre-flight: consumed reservation with evidenceId returns prior evidence',
    /reservation\.evidenceId/.test(route) && /fieldPhotoEvidence\.findUnique\(\s*\{\s*where:\s*\{\s*id:\s*reservation\.evidenceId/.test(route));

  ok(16, 'pre-flight: fall back to localUuid lookup for idempotent replay',
    /findUnique\(\s*\{\s*where:\s*\{\s*localUuid/.test(route));

  ok(17, 'claim/duplicate failure re-fetches by localUuid and returns duplicate:true',
    /duplicate:\s*true/.test(route));

  ok(18, 'top-of-handler localUuid short-circuit returns existing record',
    /const existing = await prisma\.fieldPhotoEvidence\.findUnique\(\s*\{\s*where:\s*\{\s*localUuid/.test(route));

  // --- Schema + migration -------------------------------------------------
  ok(19, 'schema: EvidenceUploadReservation has consumedAt + evidenceId',
    /model EvidenceUploadReservation[\s\S]*?consumedAt\s+DateTime\?/.test(schema) &&
    /model EvidenceUploadReservation[\s\S]*?evidenceId\s+String\?/.test(schema));

  const MIG = 'prisma/migrations/0024_evidence_reservation_atomic/migration.sql';
  ok(20, 'migration 0024 exists and is additive (ADD COLUMN IF NOT EXISTS only)',
    exists(MIG) &&
    /ADD COLUMN IF NOT EXISTS "consumedAt"/.test(read(MIG)) &&
    /ADD COLUMN IF NOT EXISTS "evidenceId"/.test(read(MIG)) &&
    !/DROP\s+COLUMN/i.test(read(MIG)) && !/DROP\s+TABLE/i.test(read(MIG)));

  // --- Live -------------------------------------------------------------
  liveRequired(21, 'two concurrent register calls on one reservation → exactly one evidence',
    'fire two simultaneous POSTs with same reservationId, different localUuid; expect one 200 create + one 409/duplicate, one evidence row');
  liveRequired(22, 'DB fault during create leaves reservation reusable (not consumed)',
    'inject a create failure; confirm reservation.consumed stays false and a later retry succeeds');
  liveRequired(23, 'lost-response retry (same localUuid) returns the original evidence idempotently',
    'replay the exact register payload; expect duplicate:true with the same EV-###### ref');

  console.log(`\n${pass} passed, ${fail} failed (non-live checks).`);
  if (live.length) {
    console.log(`\n${live.length} check(s) require a live server/Postgres to fully validate:`);
    for (const l of live) console.log(`  • ${l}`);
  }
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
