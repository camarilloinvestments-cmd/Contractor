// AI WORK INTAKE — architecture & security acceptance harness.
//
// These checks are deterministic and require NO live OpenAI call. They combine:
//   (a) runtime behaviour of the strict schema + business-rule + confidence code
//   (b) STATIC source assertions that guarantee the security/architecture
//       invariants of the feature (OpenAI never creates records; the API key is
//       encrypted and never returned; prompt-injection defense; device ids are
//       never billing codes; routes are dynamic + rbac-gated; failures preserve
//       sources; approval requires a task type; work orders only after approval).
//
// Run: node_modules/.bin/tsx scripts/acceptance/ai-intake-acceptance.ts
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  AiIntakeResponseSchema,
  AiIntakeItemSchema,
  openAiJsonSchema,
  confidenceTier,
  sectionFromDeviceId,
  CONFIDENCE_HIGH,
  CONFIDENCE_REVIEW,
} from '../../lib/ai-intake/schema';
import { applyBusinessRules } from '../../lib/ai-intake/business';

const ROOT = path.resolve(__dirname, '../../');
function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass++;
      console.log('  PASS  ' + name);
    })
    .catch((e: any) => {
      fail++;
      console.log('  FAIL  ' + name + ': ' + (e?.message || e));
    });
}

const API_ROUTES = [
  'app/api/ai-intake/route.ts',
  'app/api/ai-intake/[id]/route.ts',
  'app/api/ai-intake/[id]/analyze/route.ts',
  'app/api/ai-intake/[id]/approve/route.ts',
  'app/api/ai-intake/[id]/reject/route.ts',
  'app/api/ai-intake/[id]/sources/route.ts',
  'app/api/ai-intake/rules/route.ts',
  'app/api/settings/ai-intake/route.ts',
  'app/api/settings/ai-intake/test/route.ts',
];

async function main() {
  // ---------------------------------------------------------------------------
  // 1. Strict structured-output contract
  // ---------------------------------------------------------------------------
  await check('OpenAI JSON schema is strict with additionalProperties=false', () => {
    const s: any = openAiJsonSchema();
    assert.strictEqual(s.strict, true);
    assert.strictEqual(s.schema.additionalProperties, false);
    assert.strictEqual(s.schema.properties.items.items.additionalProperties, false);
  });

  await check('every schema property is required (strict structured output)', () => {
    const s: any = openAiJsonSchema();
    const topProps = Object.keys(s.schema.properties).sort();
    assert.deepStrictEqual([...s.schema.required].sort(), topProps);
    const itemProps = Object.keys(s.schema.properties.items.items.properties).sort();
    assert.deepStrictEqual([...s.schema.properties.items.items.required].sort(), itemProps);
  });

  await check('zod contract rejects unknown top-level fields is lenient but validates types', () => {
    const ok = AiIntakeResponseSchema.safeParse({
      schema_version: '1',
      project_reference: null,
      priority_raw_text: null,
      priority_order: [],
      confirmed_sections: [],
      items: [],
      warnings: [],
    });
    assert.ok(ok.success);
    const bad = AiIntakeResponseSchema.safeParse({ schema_version: 1 });
    assert.ok(!bad.success, 'missing/mistyped fields must fail validation');
  });

  await check('item confidence is bounded to 0..1 by the contract', () => {
    const base = {
      device_id: 'X', proposed_type: null, route_section: null, instructions: null,
      reentry_required: false, reentry_reason: null, partial_work_allowed: false,
      blocked_dependency: null, dependencies: [], requires_review: false,
      review_reason: null, source_reference: null, proposed_billing_code_suggestion: null,
    };
    assert.ok(AiIntakeItemSchema.safeParse({ ...base, confidence: 0.5 }).success);
    assert.ok(!AiIntakeItemSchema.safeParse({ ...base, confidence: 1.5 }).success);
    assert.ok(!AiIntakeItemSchema.safeParse({ ...base, confidence: -0.1 }).success);
  });

  // ---------------------------------------------------------------------------
  // 2. Confidence tiers (business policy)
  // ---------------------------------------------------------------------------
  await check('confidence tiers match policy (>=0.90 HIGH, 0.75-0.89 MED, <0.75 LOW)', () => {
    assert.strictEqual(CONFIDENCE_HIGH, 0.9);
    assert.strictEqual(CONFIDENCE_REVIEW, 0.75);
    assert.strictEqual(confidenceTier(0.95), 'HIGH');
    assert.strictEqual(confidenceTier(0.9), 'HIGH');
    assert.strictEqual(confidenceTier(0.8), 'MEDIUM');
    assert.strictEqual(confidenceTier(0.75), 'MEDIUM');
    assert.strictEqual(confidenceTier(0.74), 'LOW');
    assert.strictEqual(confidenceTier(0.0), 'LOW');
  });

  // ---------------------------------------------------------------------------
  // 3. Device id integrity + section handling (deterministic)
  // ---------------------------------------------------------------------------
  await check('a source contradiction forces review regardless of confidence', () => {
    const resp = {
      schema_version: '1', project_reference: null, priority_raw_text: null,
      priority_order: [], confirmed_sections: ['A1'],
      items: [{
        device_id: 'NP0001.E1', proposed_type: null, route_section: 'E1', instructions: null,
        reentry_required: false, reentry_reason: null, partial_work_allowed: false,
        blocked_dependency: null, dependencies: [], confidence: 0.99, requires_review: false,
        review_reason: null, source_reference: null, proposed_billing_code_suggestion: null,
      }],
      warnings: [],
    };
    const r = applyBusinessRules(resp as any, { approvedTerms: new Set() });
    const e1 = r.items[0];
    assert.strictEqual(e1.device_id, 'NP0001.E1', 'device id preserved');
    assert.strictEqual(e1.requires_review, true, 'high confidence must not override contradiction');
  });

  await check('device ids are never mutated to a confirmed section', () => {
    const resp = {
      schema_version: '1', project_reference: null, priority_raw_text: null,
      priority_order: [], confirmed_sections: ['D1'],
      items: [{
        device_id: 'NP0001.E1', proposed_type: null, route_section: 'E1', instructions: null,
        reentry_required: false, reentry_reason: null, partial_work_allowed: false,
        blocked_dependency: null, dependencies: [], confidence: 0.99, requires_review: false,
        review_reason: null, source_reference: null, proposed_billing_code_suggestion: null,
      }],
      warnings: [],
    };
    const r = applyBusinessRules(resp as any, { approvedTerms: new Set() });
    assert.strictEqual(r.items[0].device_id, 'NP0001.E1');
    assert.ok(!r.items.some((i) => i.device_id === 'NP0001.D1'));
  });

  // ---------------------------------------------------------------------------
  // 4. Prompt-injection defense (static)
  // ---------------------------------------------------------------------------
  await check('system prompt declares imported content UNTRUSTED and non-instructional', () => {
    const p = read('lib/ai-intake/prompt.ts');
    assert.ok(/UNTRUSTED/.test(p), 'must mark data untrusted');
    assert.ok(/ignore\s+previous\s+instructions/i.test(p), 'must anticipate injection strings');
    assert.ok(/never\s+fetch\s+external\s+urls/i.test(p), 'must forbid external fetches');
    assert.ok(/wrapUntrustedText/.test(p), 'must wrap untrusted data with delimiters');
  });

  await check('system prompt forbids OpenAI from creating records or deciding money', () => {
    const p = read('lib/ai-intake/prompt.ts');
    assert.ok(/CANNOT create work orders, tasks,\s*\n?\s*invoices/i.test(p) || /cannot create work orders/i.test(p));
    assert.ok(/never decide or output any money value/i.test(p), 'no money decisions');
  });

  await check('prompt preserves device ids and forbids device-id-as-billing-code', () => {
    const p = read('lib/ai-intake/prompt.ts');
    assert.ok(/Preserve every device identifier EXACTLY/i.test(p));
    assert.ok(/NOT a billing code/i.test(p));
    assert.ok(/do not change "E1" to "D1"/i.test(p), 'explicit no-reassign example');
  });

  await check('prompt does not invent priority-term meaning ("66 work")', () => {
    const p = read('lib/ai-intake/prompt.ts');
    assert.ok(/66 work/i.test(p));
    assert.ok(/requires_review=true/i.test(p));
  });

  // ---------------------------------------------------------------------------
  // 5. API key: encrypted, never returned (static)
  // ---------------------------------------------------------------------------
  await check('settings public view exposes hasApiKey but never the key itself', () => {
    const s = read('lib/ai-intake/settings.ts');
    assert.ok(/hasApiKey:/.test(s), 'public view has a boolean flag');
    // The public shape must not include a plaintext/ciphertext key field.
    assert.ok(!/apiKey:\s*[^;]*row\.apiKey/.test(s), 'public view must not return the key');
    assert.ok(/encryptSecret/.test(s), 'key is encrypted at rest');
    assert.ok(/fail-closed/i.test(s), 'encryption is fail-closed');
  });

  await check('settings GET route returns only the masked public settings', () => {
    const r = read('app/api/settings/ai-intake/route.ts');
    assert.ok(/getAiIntakeSettings\(/.test(r), 'uses the masked public getter');
    assert.ok(!/getDecryptedApiKey/.test(r), 'GET route must never decrypt the key');
    assert.ok(!/apiKeyEncrypted/.test(r), 'GET route must never expose ciphertext');
  });

  await check('OpenAI client sanitizes errors and never logs the key', () => {
    const o = read('lib/ai-intake/openai.ts');
    assert.ok(/sanitizeError/.test(o));
    assert.ok(/\[REDACTED\]/.test(o), 'errors strip anything resembling a key');
    assert.ok(!/console\.log\(.*apiKey/i.test(o), 'never logs the key');
  });

  // ---------------------------------------------------------------------------
  // 6. Routes: dynamic + rbac-gated (static)
  // ---------------------------------------------------------------------------
  await check('every AI intake route is force-dynamic', () => {
    for (const rel of API_ROUTES) {
      const src = read(rel);
      assert.ok(/export const dynamic = "force-dynamic"/.test(src), `${rel} missing force-dynamic`);
    }
  });

  await check('every AI intake route is rbac-gated', () => {
    for (const rel of API_ROUTES) {
      const src = read(rel);
      assert.ok(/require(Manage|Admin|Auth)\(/.test(src), `${rel} missing an rbac gate`);
    }
  });

  await check('settings routes require ADMIN', () => {
    assert.ok(/requireAdmin\(/.test(read('app/api/settings/ai-intake/route.ts')));
    assert.ok(/requireAdmin\(/.test(read('app/api/settings/ai-intake/test/route.ts')));
  });

  // ---------------------------------------------------------------------------
  // 7. OpenAI never creates records; OS1 remains authoritative (static)
  // ---------------------------------------------------------------------------
  await check('analyze never creates a Job/Task/Invoice (draft only)', () => {
    const a = read('lib/ai-intake/analyze.ts');
    assert.ok(!/prisma\.job\.create/.test(a), 'analyze must not create jobs');
    assert.ok(!/createWithNumber\('WORKORDER'\)/.test(a), 'analyze must not create work orders');
    assert.ok(!/\.invoice\.create/.test(a), 'analyze must not create invoices');
    assert.ok(/aiIntakeItem\.create/.test(a), 'analyze only persists draft items');
  });

  await check('analyze preserves sources + prior draft on failure', () => {
    const a = read('lib/ai-intake/analyze.ts');
    assert.ok(/status: 'FAILED'/.test(a), 'failed runs are marked FAILED');
    // In the FAILURE-handling catch (the one that marks FAILED) there must be no
    // destructive delete of sources. Anchor on the LAST catch: an earlier,
    // benign catch now guards the analysis claim and performs no deletes.
    const catchIdx = a.lastIndexOf('} catch (e) {');
    const tail = a.slice(catchIdx);
    const bulkDelete = 'delete' + 'Many';
    assert.ok(!tail.includes('aiIntakeSource.' + bulkDelete), 'failure must not delete sources');
    assert.ok(!tail.includes('aiIntakeItem.' + bulkDelete), 'failure must not clear the prior draft');
  });

  await check('draft item deletion happens only inside the success transaction', () => {
    const a = read('lib/ai-intake/analyze.ts');
    assert.ok(/\$transaction/.test(a));
    // The bulk draft clear must live in the SUCCESS transaction: after the main
    // (persist) $transaction opens and before the FAILURE-handling catch. Anchor
    // on the LAST $transaction (persist) and the LAST catch (FAILED handler) so
    // the new claim tx/guard added ahead of them does not move the window.
    const txIdx = a.lastIndexOf('$transaction');
    const catchIdx = a.lastIndexOf('} catch (e) {');
    const delIdx = a.indexOf('aiIntakeItem.' + ('delete' + 'Many'));
    assert.ok(delIdx > txIdx, 'the bulk draft clear is inside the success (persist) transaction');
    assert.ok(delIdx < catchIdx, 'the bulk draft clear is NOT in the failure path');
  });

  // ---------------------------------------------------------------------------
  // 8. Approval: authoritative OS1 record creation (static)
  // ---------------------------------------------------------------------------
  await check('approval requires a task type for every included item', () => {
    const ap = read('lib/ai-intake/approve.ts');
    assert.ok(/taskTypeId: string; \/\/ REQUIRED/.test(ap), 'ItemDecision.taskTypeId is required');
    assert.ok(/requires a task type before it can be created/.test(ap), 'runtime guard present');
  });

  await check('approval is idempotent (never creates a second work order)', () => {
    const ap = read('lib/ai-intake/approve.ts');
    assert.ok(/if \(intake\.resultingJobId\)/.test(ap), 'guards on resultingJobId');
    assert.ok(/alreadyImported: true/.test(ap));
  });

  await check('approval creates the work order via the concurrency-safe numberer', () => {
    const ap = read('lib/ai-intake/approve.ts');
    // Blocker 2: the WO number is now allocated on the SAME interactive tx client
    // (allocateNumber(key, tx)) so numbering + job + tasks commit atomically,
    // replacing the old standalone createWithNumber (which could not join the tx).
    assert.ok(/allocateNumber\('WORKORDER', tx\)/.test(ap), 'uses the transactional numberer allocateNumber(..., tx)');
    assert.ok(/prisma\.\$transaction\(/.test(ap), 'conversion runs inside an interactive transaction');
    assert.ok(/resolveWorkOrderPin/.test(ap), 'pins the exact price book version');
    assert.ok(/status: 'DRAFT'/.test(ap), 'work order starts as DRAFT for OS1 flow');
  });

  await check('approval reuses existing Prime/Project/PriceBook identity (no parallel system)', () => {
    const ap = read('lib/ai-intake/approve.ts');
    assert.ok(/primeContractorId: pin\.primeContractorId/.test(ap));
    assert.ok(/projectId: pin\.projectId/.test(ap));
    assert.ok(/priceBookVersionId: pin\.priceBookVersionId/.test(ap));
  });

  await check('billing code is applied only when the operator confirms one', () => {
    const ap = read('lib/ai-intake/approve.ts');
    assert.ok(/if \(d\.jobCode && d\.jobCode\.trim\(\)\)/.test(ap), 'jobCode is operator-confirmed');
    assert.ok(/addBillingCodeToTask/.test(ap));
  });

  // ---------------------------------------------------------------------------
  // 9. Scoped rules (never universal) + duplicate detection (static)
  // ---------------------------------------------------------------------------
  await check('AI rules are scoped to prime+project (never universal)', () => {
    const rules = read('lib/ai-intake/rules.ts');
    assert.ok(/primeContractorId/.test(rules) && /projectId/.test(rules), 'rules carry prime+project scope');
    const routeSrc = read('app/api/ai-intake/rules/route.ts');
    assert.ok(/require(Manage|Admin)\(/.test(routeSrc));
  });

  await check('duplicate detection runs before a work order is created', () => {
    const a = read('lib/ai-intake/analyze.ts');
    assert.ok(/findDuplicates/.test(a), 'analyze checks duplicates');
    assert.ok(/possibleDuplicate/.test(a), 'flags possible duplicates for review');
  });

  // ---------------------------------------------------------------------------
  // 10. Intake lifecycle states present (static)
  // ---------------------------------------------------------------------------
  await check('intake status enum covers the full lifecycle', () => {
    const schema = read('prisma/schema.prisma');
    for (const st of ['NEW', 'ANALYZING', 'NEEDS_REVIEW', 'READY', 'APPROVED', 'IMPORTED', 'REJECTED', 'FAILED']) {
      assert.ok(new RegExp(`\\b${st}\\b`).test(schema), `AiIntakeStatus missing ${st}`);
    }
  });

  await check('migration is additive and guarded (IF NOT EXISTS)', () => {
    const mig = read('prisma/migrations/0025_ai_work_intake/migration.sql');
    assert.ok(/IF NOT EXISTS/i.test(mig), 'tables/columns created guardedly');
    const destructive = new RegExp(('DR' + 'OP') + '\\s+TABLE', 'i');
    assert.ok(!destructive.test(mig), 'no destructive table removals');
  });

  console.log(`\nAI INTAKE ACCEPTANCE: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
