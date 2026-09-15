// BLOCKER 3 - server-enforced review-gate acceptance harness.
//
// Proves that a flagged intake item (requiresReview OR possibleDuplicate) can be
// operationalized ONLY after an operator persists an explicit, validated
// resolution: EXCLUDED items are omitted, a still-PENDING flagged item REJECTS
// the whole approval, and only CONFIRMED/CORRECTED may proceed. The resolution
// is a persisted enum column, validated server-side, with resolver audit fields.
// Static source assertions only (deterministic; NO live DB).
//
// Run: node_modules/.bin/tsx scripts/acceptance/review-gate-acceptance.ts
import assert from 'assert';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    pass++;
    console.log('  PASS  ' + name);
  } catch (e: any) {
    fail++;
    console.log('  FAIL  ' + name + ': ' + (e?.message || e));
  }
}

function main() {
  console.log('REVIEW GATE ACCEPTANCE');

  check('schema persists a validated review-resolution enum', () => {
    const schema = read('prisma/schema.prisma');
    const enumIdx = schema.indexOf('enum AiItemReviewResolution');
    assert.ok(enumIdx !== -1, 'AiItemReviewResolution enum must exist');
    const enumBlock = schema.slice(enumIdx, schema.indexOf('}', enumIdx));
    for (const v of ['PENDING', 'CONFIRMED', 'CORRECTED', 'EXCLUDED']) {
      assert.ok(new RegExp('\\b' + v + '\\b').test(enumBlock), `enum must include ${v}`);
    }
    // The item carries the column (default PENDING) plus resolver audit fields.
    assert.ok(/reviewResolution\s+AiItemReviewResolution @default\(PENDING\)/.test(schema), 'item defaults to PENDING');
    assert.ok(/reviewedById/.test(schema) && /reviewedAt/.test(schema) && /reviewNote/.test(schema), 'resolver audit fields exist');
  });

  check('approval REJECTS an included flagged item still PENDING', () => {
    const src = read('lib/ai-intake/approve.ts');
    const flaggedIdx = src.indexOf('const flagged = it.requiresReview || it.possibleDuplicate');
    assert.ok(flaggedIdx !== -1, 'flag derives from requiresReview OR possibleDuplicate');
    const gate = src.slice(flaggedIdx, flaggedIdx + 700);
    // Must throw unless the resolution is CONFIRMED or CORRECTED.
    assert.ok(/reviewResolution !== 'CONFIRMED' && it\.reviewResolution !== 'CORRECTED'/.test(gate), 'only CONFIRMED/CORRECTED proceed');
    assert.ok(/AiApproveError\(/.test(gate), 'a PENDING flagged item throws');
  });

  check('EXCLUDED flagged items are omitted (never tasked)', () => {
    const src = read('lib/ai-intake/approve.ts');
    assert.ok(/reviewResolution === 'EXCLUDED'/.test(src), 'checks for EXCLUDED');
    const exclIdx = src.indexOf("reviewResolution === 'EXCLUDED'");
    assert.ok(/continue;/.test(src.slice(exclIdx, exclIdx + 120)), 'EXCLUDED items are skipped, not tasked');
  });

  check('the gate is server-side and cannot be bypassed from the client draft', () => {
    const src = read('lib/ai-intake/approve.ts');
    // The gate reads the PERSISTED column it.reviewResolution, not client input.
    assert.ok(/it\.reviewResolution/.test(src), 'gate reads the persisted item column');
    // An empty operational set after exclusions still aborts.
    assert.ok(/operational\.length === 0/.test(src), 'aborts when nothing remains after exclusions');
  });

  check('draft-edit validates the resolution enum (400 on junk) and records the resolver', () => {
    // The enum allow-list + resolver-audit logic lives in the shared draft-edit
    // mutation path; the route maps DraftEditValidationError -> HTTP 400.
    const lib = read('lib/ai-intake/draft-edit.ts');
    const route = read('app/api/ai-intake/[id]/route.ts');
    assert.ok(/REVIEW_RESOLUTIONS = \['PENDING', 'CONFIRMED', 'CORRECTED', 'EXCLUDED'\]/.test(lib), 'server allow-list of enum values');
    assert.ok(/isReviewResolution\(upd\.reviewResolution\)/.test(lib), 'validates the incoming value');
    assert.ok(/throw new DraftEditValidationError\(/.test(lib), 'invalid enum throws a validation error');
    assert.ok(/DraftEditValidationError\)[\s\S]{0,120}status: 400/.test(route), 'route maps the validation error to 400');
    // A non-PENDING (explicit) decision records who resolved it and when.
    const setIdx = lib.indexOf('data.reviewResolution = upd.reviewResolution');
    const blk = lib.slice(setIdx, setIdx + 400);
    assert.ok(/data\.reviewedById = actor\.id/.test(blk), 'records the resolver id');
    assert.ok(/data\.reviewedAt = new Date\(\)/.test(blk), 'records the resolution time');
    assert.ok(/data\.reviewedById = null/.test(blk) && /data\.reviewedAt = null/.test(blk), 'PENDING clears the resolver audit');
  });

  check('the authoritative gate runs on rows RE-READ inside the approval tx', () => {
    const src = read('lib/ai-intake/approve.ts');
    const txIdx = src.indexOf('prisma.$transaction(');
    const body = src.slice(txIdx);
    assert.ok(/tx\.aiIntakeItem\.findMany\(\{ where: \{ intakeId \} \}\)/.test(body), 'items re-read via the tx client');
    assert.ok(/selectOperationalItems\(freshItems/.test(body), 'gate evaluated on the tx-fetched rows, not the pre-tx snapshot');
  });

  check('draft edits are refused (409) while not draft-mutable, via the tx state-lock', () => {
    const lock = read('lib/ai-intake/state-lock.ts');
    const lib = read('lib/ai-intake/draft-edit.ts');
    const route = read('app/api/ai-intake/[id]/route.ts');
    // The authoritative draft-mutable set EXCLUDES the in-flight/terminal states.
    assert.ok(/MUTABLE_DRAFT_STATUSES = \['NEW', 'READY', 'NEEDS_REVIEW', 'FAILED'\]/.test(lock), 'draft-mutable allow-list');
    for (const s of ['ANALYZING', 'APPROVING', 'IMPORTED', 'REJECTED']) {
      assert.ok(!new RegExp("MUTABLE_DRAFT_STATUSES = \\[[^\\]]*'" + s + "'").test(lock), `${s} is NOT draft-mutable`);
    }
    // The claim is a conditional updateMany that bumps revision; zero rows -> throw.
    assert.ok(/export async function claimForDraftEdit/.test(lock), 'exposes claimForDraftEdit');
    assert.ok(/updateMany\([\s\S]{0,200}status: \{ in: \[\.\.\.MUTABLE_DRAFT_STATUSES\] \}/.test(lock), 'claim conditions on the mutable set');
    assert.ok(/res\.count !== 1[\s\S]{0,200}IntakeStateLockError/.test(lock), 'a losing claim throws IntakeStateLockError');
    // The shared mutation path calls the claim as the FIRST statement in the tx.
    assert.ok(/\$transaction\(async \(tx\) => \{\s*await claimForDraftEdit\(tx, intakeId\)/.test(lib), 'claim is the first write inside the edit tx');
    // The route maps the lock error to HTTP 409.
    assert.ok(/IntakeStateLockError\)[\s\S]{0,160}status: 409/.test(route), 'route maps the state-lock error to 409');
  });

  check('review-decision audit trail records old->new resolution + resolver (no source content)', () => {
    const route = read('lib/ai-intake/draft-edit.ts');
    assert.ok(/reviewDecisions\b/.test(route), 'builds a reviewDecisions audit array');
    const decIdx = route.indexOf('reviewDecisions.push(');
    assert.ok(decIdx !== -1, 'pushes a per-item decision record');
    const rec = route.slice(decIdx, decIdx + 400);
    for (const f of ['itemId', 'deviceId', 'oldResolution', 'newResolution', 'reviewedBy']) {
      assert.ok(new RegExp('\\b' + f + '\\b').test(rec), `audit record includes ${f}`);
    }
    // Only recorded when the resolution actually changes.
    assert.ok(/oldResolution !== upd\.reviewResolution/.test(route), 'only logs an actual transition');
    // Note is bounded and presence-flagged; source/AI document content never logged.
    assert.ok(/reviewNotePresent/.test(rec), 'flags note presence rather than dumping content');
    assert.ok(/slice\(0, 200\)/.test(rec), 'bounds any logged note to 200 chars');
    // The audit metadata carries the array.
    const auditIdx = route.indexOf("action: 'ai_intake.edited'");
    assert.ok(/reviewDecisions,/.test(route.slice(auditIdx, auditIdx + 300)), 'edited audit metadata carries reviewDecisions');
  });

  console.log(`\nREVIEW GATE ACCEPTANCE: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
