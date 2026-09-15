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
    const claim = body.slice(claimIdx, claimIdx + 400);
    assert.ok(/resultingJobId: null/.test(claim), 'claim requires resultingJobId null');
    assert.ok(/status: \{ notIn: \['IMPORTED', 'APPROVING', 'REJECTED'\] \}/.test(claim), 'claim excludes already-claimed/finalized states');
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

  console.log(`\nAPPROVAL CONCURRENCY ACCEPTANCE: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
