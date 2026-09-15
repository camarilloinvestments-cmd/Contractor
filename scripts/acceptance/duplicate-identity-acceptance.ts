// BLOCKER 4 - duplicate-identity acceptance harness.
//
// Proves duplicate detection keys off a DURABLE, NON-FINANCIAL work/device
// identifier (Task.sourceWorkRef, snapshotted from item.deviceId), NOT the
// billing code. The billing-code/description substring scan survives ONLY as a
// legacy fallback (matchedBy 'legacyText'), never the primary identity signal.
// Static source assertions only (deterministic; NO live DB).
//
// Run: node_modules/.bin/tsx scripts/acceptance/duplicate-identity-acceptance.ts
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
  console.log('DUPLICATE IDENTITY ACCEPTANCE');

  check('schema stores a durable, indexed, non-financial source identifier on Task', () => {
    const schema = read('prisma/schema.prisma');
    assert.ok(/sourceWorkRef\s+String\?/.test(schema), 'Task.sourceWorkRef column exists');
    assert.ok(/@@index\(\[sourceWorkRef\]\)/.test(schema), 'sourceWorkRef is indexed for lookups');
    // The comment must make clear it is NEVER a billing code.
    const idx = schema.indexOf('sourceWorkRef');
    assert.ok(/NEVER a billing code/i.test(schema.slice(idx, idx + 200)), 'documented as non-financial');
  });

  check('detection selects and matches on sourceWorkRef as the PRIMARY signal', () => {
    const src = read('lib/ai-intake/duplicate.ts');
    assert.ok(/sourceWorkRef: true/.test(src), 'query selects sourceWorkRef');
    const primaryIdx = src.indexOf('const ref = task.sourceWorkRef');
    assert.ok(primaryIdx !== -1, 'primary match reads task.sourceWorkRef');
    const primary = src.slice(primaryIdx, primaryIdx + 400);
    assert.ok(/matchedBy: 'sourceWorkRef'/.test(primary), 'primary hit is labelled sourceWorkRef');
  });

  check('the DuplicateHit distinguishes primary vs legacy provenance', () => {
    const src = read('lib/ai-intake/duplicate.ts');
    assert.ok(/matchedBy: 'sourceWorkRef' \| 'legacyText'/.test(src), 'hit records how it matched');
  });

  check('billing code is NOT the identity key (legacy substring is fallback only)', () => {
    const src = read('lib/ai-intake/duplicate.ts');
    const refIdx = src.indexOf('const ref = task.sourceWorkRef');
    const legacyIdx = src.indexOf("matchedBy: 'legacyText'");
    assert.ok(refIdx !== -1 && legacyIdx !== -1, 'both paths exist');
    assert.ok(refIdx < legacyIdx, 'the durable match runs BEFORE the legacy substring scan');
    // A durable match short-circuits the legacy scan for that task.
    assert.ok(/if \(matched\) continue;/.test(src), 'a sourceWorkRef hit skips the legacy scan');
    // billingCode only appears in the legacy haystack, never as an equality key.
    assert.ok(!/idSet\.has\([^)]*billingCode/.test(src), 'billingCode is never the identity lookup key');
  });

  check('approval snapshots the device id into Task.sourceWorkRef', () => {
    const src = read('lib/ai-intake/approve.ts');
    assert.ok(/const sourceWorkRef = it\.deviceId \?\? null/.test(src), 'sourceWorkRef derived from item.deviceId');
    // Both task-creation paths persist it.
    const codePath = src.indexOf('addBillingCodeToTask({');
    assert.ok(/sourceWorkRef,/.test(src.slice(codePath, codePath + 400)), 'billing-code path stores sourceWorkRef');
    const plainPath = src.indexOf('tx.task.create({');
    assert.ok(/sourceWorkRef,/.test(src.slice(plainPath, plainPath + 500)), 'plain-task path stores sourceWorkRef');
  });

  check('the work-order helper threads sourceWorkRef through to the Task row', () => {
    const wo = read('lib/work-orders.ts');
    assert.ok(/sourceWorkRef/.test(wo), 'addBillingCodeToTask accepts and writes sourceWorkRef');
  });

  console.log(`\nDUPLICATE IDENTITY ACCEPTANCE: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
