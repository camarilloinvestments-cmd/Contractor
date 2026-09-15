// BLOCKER 2 - approval concurrency & atomicity acceptance harness.
//
// Proves that converting an analyzed intake into a Work Order is atomic and
// concurrency-safe: one intake yields AT MOST one work order, everything is
// committed all-or-nothing inside a single interactive transaction, the claim
// runs INSIDE that transaction, a lost-response retry returns the SAME work
// order, and a unique-violation is retried cleanly. Static source assertions
// only (deterministic; NO live DB mutation).
//
// Run: node_modules/.bin/tsx scripts/acceptance/approval-concurrency-acceptance.ts
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
  console.log('APPROVAL CONCURRENCY ACCEPTANCE');
  const src = read('lib/ai-intake/approve.ts');

  check('schema carries the intermediate APPROVING state', () => {
    const schema = read('prisma/schema.prisma');
    const enumBlock = schema.slice(schema.indexOf('enum AiIntakeStatus'), schema.indexOf('}', schema.indexOf('enum AiIntakeStatus')));
    assert.ok(/\bAPPROVING\b/.test(enumBlock), 'AiIntakeStatus must include APPROVING');
  });

  check('idempotency short-circuit: an already-imported intake returns its existing job', () => {
    // Guard must exist BEFORE any write path.
    const guardIdx = src.indexOf('if (intake.resultingJobId)');
    assert.ok(guardIdx !== -1, 'must guard on intake.resultingJobId');
    assert.ok(/alreadyImported: true/.test(src.slice(guardIdx, guardIdx + 300)), 'returns the existing job with alreadyImported');
    // The short-circuit precedes the transaction.
    assert.ok(guardIdx < src.indexOf('$transaction'), 'idempotency guard precedes the transaction');
  });

  check('the entire conversion runs inside a single interactive $transaction', () => {
    const txCount = (src.match(/prisma\.\$transaction\(/g) || []).length;
    assert.strictEqual(txCount, 1, 'exactly one $transaction opens the write path');
    const txIdx = src.indexOf('prisma.$transaction(');
    const body = src.slice(txIdx);
    // Job, tasks, item links, and IMPORTED finalize must all be on the tx client.
    assert.ok(/tx\.job\.create/.test(body), 'job created on tx');
    assert.ok(/tx\.aiIntakeItem\.update/.test(body), 'item->task links on tx');
    assert.ok(/status: 'IMPORTED'/.test(body), 'IMPORTED finalize inside tx');
    assert.ok(/resultingJobId: job\.id/.test(body), 'resultingJobId set inside tx');
  });

  check('concurrency-safe claim: conditional updateMany -> APPROVING inside the tx', () => {
    const txIdx = src.indexOf('prisma.$transaction(');
    const body = src.slice(txIdx);
    const claimIdx = body.indexOf('tx.aiWorkIntake.updateMany');
    assert.ok(claimIdx !== -1, 'claim uses tx.aiWorkIntake.updateMany');
    const claim = body.slice(claimIdx, claimIdx + 700);
    assert.ok(/resultingJobId: null/.test(claim), 'claim requires resultingJobId null');
    assert.ok(/status: \{ in: \['READY', 'NEEDS_REVIEW'\] \}/.test(claim), 'claim admits ONLY an analyzed draft (READY/NEEDS_REVIEW)');
    assert.ok(/data: \{ status: 'APPROVING' \}/.test(claim), 'claim moves status to APPROVING');
    // A losing caller (count !== 1) must NOT create a second job.
    assert.ok(/claim\.count !== 1/.test(body), 'branches when the claim matches zero rows');
  });

  check('a lost-response retry returns the SAME work order (no duplicate)', () => {
    const txIdx = src.indexOf('prisma.$transaction(');
    const body = src.slice(txIdx);
    // When the claim fails and the intake already has a job, return that job.
    assert.ok(/if \(cur\?\.resultingJobId\)/.test(body), 'checks the live resultingJobId on a failed claim');
    assert.ok(/kind: 'existing'/.test(body), 'returns the existing job branch');
  });

  check('authoritative review gate re-reads item rows INSIDE the tx (no stale snapshot)', () => {
    const txIdx = src.indexOf('prisma.$transaction(');
    const body = src.slice(txIdx);
    // Items feeding the gate must be fetched via the tx client, not the pre-tx
    // intake.items snapshot, so a concurrent PATCH cannot authorize a stale task.
    assert.ok(/tx\.aiIntakeItem\.findMany\(\{ where: \{ intakeId \} \}\)/.test(body), 'item rows re-read via tx.aiIntakeItem.findMany inside the tx');
    const gateIdx = body.indexOf('selectOperationalItems(freshItems');
    assert.ok(gateIdx !== -1, 'gate evaluated on the tx-fetched freshItems');
    const claimIdx = body.indexOf('tx.aiWorkIntake.updateMany');
    assert.ok(claimIdx !== -1 && claimIdx < gateIdx, 'gate runs AFTER the APPROVING claim, on stable rows');
    // The task-creation loop must consume the tx-derived operational list.
    assert.ok(/for \(const it of operational\)/.test(body), 'tasks are created from the tx-derived operational list');
  });

  check('the WO number is allocated on the SAME tx client', () => {
    const txIdx = src.indexOf('prisma.$transaction(');
    const body = src.slice(txIdx);
    assert.ok(/allocateNumber\('WORKORDER', tx\)/.test(body), 'allocateNumber must receive the tx client');
  });

  check('unique-violation (P2002) is retried; other errors propagate', () => {
    assert.ok(/PrismaClientKnownRequestError/.test(src), 'catches Prisma known request errors');
    assert.ok(/err\.code === 'P2002'/.test(src), 'retries specifically on P2002');
    assert.ok(/attempt < MAX_ATTEMPTS - 1/.test(src), 'bounded retry loop');
    // The final fallthrough re-throws non-P2002 errors.
    assert.ok(/throw err;/.test(src), 'non-retryable errors propagate');
  });

  check('audits are written OUTSIDE the transaction (after commit)', () => {
    const txEnd = src.lastIndexOf('{ timeout: 20000 }');
    assert.ok(txEnd !== -1, 'transaction has an explicit timeout');
    const afterTx = src.slice(txEnd);
    assert.ok(/writeAudit\(/.test(afterTx), 'audit entries are written after the tx commits');
    // No writeAudit call should sit inside the tx callback.
    const txIdx = src.indexOf('prisma.$transaction(');
    const txBody = src.slice(txIdx, txEnd);
    assert.ok(!/writeAudit\(/.test(txBody), 'no audit writes inside the transaction body');
  });

  check('source add/remove go through the SAME draft-edit state lock (fail closed)', () => {
    const sources = read('lib/ai-intake/sources.ts');
    // Registration and removal both claim the parent row FIRST inside their tx.
    assert.ok(/registerIntakeSource[\s\S]{0,220}\$transaction\(async \(tx\) => \{\s*await claimForDraftEdit\(tx, intakeId\)/.test(sources), 'registerIntakeSource claims the lock first');
    assert.ok(/removeIntakeSource[\s\S]{0,220}\$transaction\(async \(tx\) => \{\s*await claimForDraftEdit\(tx, intakeId\)/.test(sources), 'removeIntakeSource claims the lock first');
    // Removal re-verifies ownership INSIDE the locked tx.
    assert.ok(/source\.intakeId !== intakeId[\s\S]{0,80}IntakeSourceNotFoundError/.test(sources), 'removal re-checks ownership under the lock');
  });

  check('upload route validates state, then cleans up the object if it loses the race', () => {
    const route = read('app/api/ai-intake/[id]/sources/route.ts');
    // Fast pre-check on the mutable set (avoids needless uploads) ...
    assert.ok(/DRAFT_MUTABLE = new Set<string>\(\[\.\.\.MUTABLE_DRAFT_STATUSES\]\)/.test(route), 'pre-check uses the authoritative mutable set');
    assert.ok(/!DRAFT_MUTABLE\.has\(pre\.status\)[\s\S]{0,140}status: 409/.test(route), 'clearly-immutable intake is refused before upload (409)');
    // ... but the AUTHORITATIVE guard is registerIntakeSource; a lost race after
    // upload deletes the orphaned object and returns 409.
    assert.ok(/registerIntakeSource\(/.test(route), 'authoritative registration goes through the locked lib fn');
    assert.ok(/IntakeStateLockError[\s\S]{0,160}deleteFile\(cloud_storage_path\)[\s\S]{0,120}status: 409/.test(route), 'lost race cleans up the upload and returns 409');
  });

  check('analyze CLAIMS the intake before reading any input (claim-before-read)', () => {
    const analyze = read('lib/ai-intake/analyze.ts');
    const claimIdx = analyze.indexOf('claimForAnalysis(tx, intakeId)');
    assert.ok(claimIdx !== -1, 'analyze claims via claimForAnalysis');
    // The claim must precede the first read of the intake/sources.
    const readIdx = analyze.indexOf('prisma.aiWorkIntake.findUnique');
    assert.ok(readIdx !== -1 && claimIdx < readIdx, 'claim runs BEFORE reading the intake + sources');
    // The analysis claim conditions on the analyzable set and moves to ANALYZING.
    const lock = read('lib/ai-intake/state-lock.ts');
    assert.ok(/ANALYZABLE_STATUSES = \['NEW', 'FAILED', 'READY', 'NEEDS_REVIEW'\]/.test(lock), 'analyzable allow-list');
    assert.ok(/updateMany\([\s\S]{0,220}status: \{ in: \[\.\.\.ANALYZABLE_STATUSES\] \}[\s\S]{0,120}status: 'ANALYZING'/.test(lock), 'claim atomically flips to ANALYZING');
    // A second concurrent claim (already ANALYZING) is refused with a clear msg.
    assert.ok(/status === 'ANALYZING'[\s\S]{0,160}Analysis is already running/.test(lock), 'second concurrent analysis is refused');
    // A lost analysis claim must NOT set the intake to FAILED (claim is outside
    // the main try that maps errors to FAILED).
    assert.ok(/if \(e instanceof IntakeStateLockError\) throw new AiIntakeError\(e\.message\)/.test(analyze), 'lost claim surfaces a clean error, not FAILED');
  });

  console.log(`\nAPPROVAL CONCURRENCY ACCEPTANCE: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
