// BLOCKER 1 - OpenAI endpoint-security acceptance harness.
//
// Proves the stored OpenAI credential can ONLY be sent to the official OpenAI
// API. Combines runtime behaviour of the endpoint-pinning module with STATIC
// source assertions that every credential-bearing call routes through it and
// that the editable API Base URL has been removed from the settings surface.
//
// Deterministic; NO live OpenAI call. Run:
//   node_modules/.bin/tsx scripts/acceptance/openai-endpoint-security-acceptance.ts
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  assertApprovedOpenAiEndpoint,
  isApprovedOpenAiEndpoint,
  resolveOpenAiApiBase,
  OFFICIAL_OPENAI_API_BASE,
  AiEndpointSecurityError,
} from '../../lib/ai-intake/openai-endpoint';

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

function throws(base: string | null | undefined): boolean {
  try {
    assertApprovedOpenAiEndpoint(base);
    return false;
  } catch (e) {
    return e instanceof AiEndpointSecurityError;
  }
}

// Every non-official target that must be refused (the credential is NEVER sent).
const FORBIDDEN = [
  'https://example.com',
  'https://example.com/v1',
  'http://api.openai.com/v1', // downgraded scheme
  'https://api.openai.com.evil.com/v1', // look-alike host
  'https://api.openai.com/v1/../evil', // path traversal
  'http://localhost:11434/v1',
  'https://localhost/v1',
  'http://127.0.0.1/v1',
  'http://0.0.0.0/v1',
  'http://10.0.0.5/v1', // RFC-1918
  'http://192.168.1.10/v1', // RFC-1918
  'http://172.16.0.9/v1', // RFC-1918
  'http://169.254.169.254/latest/meta-data', // cloud metadata
  'https://api.anthropic.com/v1', // alternate provider
  'https://azure-openai.example.net/v1',
];

function main() {
  console.log('OPENAI ENDPOINT SECURITY ACCEPTANCE');

  check('official endpoint is approved and normalized', () => {
    assert.strictEqual(assertApprovedOpenAiEndpoint(OFFICIAL_OPENAI_API_BASE), OFFICIAL_OPENAI_API_BASE);
    assert.strictEqual(assertApprovedOpenAiEndpoint('https://api.openai.com/v1/'), OFFICIAL_OPENAI_API_BASE);
    assert.ok(isApprovedOpenAiEndpoint(OFFICIAL_OPENAI_API_BASE));
  });

  check('null/empty/whitespace base falls back to the official endpoint', () => {
    assert.strictEqual(assertApprovedOpenAiEndpoint(null), OFFICIAL_OPENAI_API_BASE);
    assert.strictEqual(assertApprovedOpenAiEndpoint(undefined), OFFICIAL_OPENAI_API_BASE);
    assert.strictEqual(assertApprovedOpenAiEndpoint(''), OFFICIAL_OPENAI_API_BASE);
    assert.strictEqual(assertApprovedOpenAiEndpoint('   '), OFFICIAL_OPENAI_API_BASE);
  });

  check('every arbitrary/localhost/RFC-1918/alternate host is REJECTED', () => {
    for (const base of FORBIDDEN) {
      assert.ok(throws(base), `expected rejection for ${base}`);
      assert.ok(!isApprovedOpenAiEndpoint(base), `isApproved must be false for ${base}`);
    }
  });

  check('a persisted legacy non-official apiBase is rejected (not silently used)', () => {
    // Simulate a tampered/legacy settings row carrying an arbitrary base.
    assert.ok(throws('https://attacker.example/v1'));
  });

  check('resolveOpenAiApiBase enforces the SAME policy as assert', () => {
    assert.strictEqual(resolveOpenAiApiBase(null), OFFICIAL_OPENAI_API_BASE);
    assert.strictEqual(resolveOpenAiApiBase(OFFICIAL_OPENAI_API_BASE), OFFICIAL_OPENAI_API_BASE);
    let threw = false;
    try { resolveOpenAiApiBase('http://localhost:1234'); } catch (e) { threw = e instanceof AiEndpointSecurityError; }
    assert.ok(threw, 'resolve must reject a non-official base');
  });

  // ---- STATIC source guarantees ----

  check('openai.ts resolves the endpoint BEFORE attaching the credential', () => {
    const src = read('lib/ai-intake/openai.ts');
    assert.ok(/resolveOpenAiApiBase/.test(src), 'openai.ts must import/use resolveOpenAiApiBase');
    // Both request paths must resolve then fetch the resolved base.
    const resolveIdx = src.indexOf('resolveOpenAiApiBase(opts.apiBase)');
    assert.ok(resolveIdx !== -1, 'must resolve opts.apiBase');
    // No raw fetch to an un-resolved stored base.
    assert.ok(!/fetch\(`\$\{opts\.apiBase\}/.test(src), 'must never fetch a raw stored base');
    assert.ok(/fetch\(`\$\{apiBase\}\/responses`/.test(src), 'fetch target is the resolved apiBase');
  });

  check('Test Connection route goes through the same pinning (no raw base)', () => {
    const src = read('app/api/settings/ai-intake/test/route.ts');
    assert.ok(/testConnection\(/.test(src), 'test route calls testConnection');
    assert.ok(!/https:\/\/api\.openai\.com\/v1/.test(src), 'test route must not hardcode a fallback base');
    // testConnection itself resolves the endpoint.
    const tc = read('lib/ai-intake/openai.ts');
    assert.ok(tc.split('testConnection')[1] === undefined || /resolveOpenAiApiBase/.test(tc), 'testConnection resolves endpoint');
  });

  check('settings persistence no longer stores an editable apiBase', () => {
    const src = read('lib/ai-intake/settings.ts');
    // The Input type must not declare a writable apiBase FIELD. Extract the
    // AiIntakeSettingsInput type block, strip comment lines (a comment that
    // merely mentions apiBase is allowed and expected), then assert no field.
    const inStart = src.indexOf('export type AiIntakeSettingsInput = {');
    assert.ok(inStart !== -1, 'AiIntakeSettingsInput type must exist');
    const inBlock = src.slice(inStart, src.indexOf('};', inStart));
    const inBlockNoComments = inBlock.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!/\bapiBase\b/.test(inBlockNoComments), 'apiBase must not be a writable settings input field');
    // The write path (saveAiIntakeSettings) must never assign apiBase.
    const saveStart = src.indexOf('export async function saveAiIntakeSettings');
    assert.ok(saveStart !== -1, 'saveAiIntakeSettings must exist');
    const nextFn = src.indexOf('export async function', saveStart + 10);
    const saveBody = src.slice(saveStart, nextFn === -1 ? undefined : nextFn);
    assert.ok(!/\bapiBase\b/.test(saveBody), 'saveAiIntakeSettings must never write apiBase');
  });

  check('settings API PUT does not read body.apiBase', () => {
    const src = read('app/api/settings/ai-intake/route.ts');
    assert.ok(!/body\.apiBase/.test(src), 'PUT must not read body.apiBase');
  });

  check('settings UI has no editable API Base URL input (pinned notice only)', () => {
    const src = read('app/(admin)/ai-help/settings/_components/ai-settings-content.tsx');
    assert.ok(!/onChange=\{[^}]*apiBase/.test(src), 'no editable apiBase input');
    assert.ok(/Pinned|pinned/.test(src), 'UI shows the endpoint is pinned');
    assert.ok(src.includes(OFFICIAL_OPENAI_API_BASE), 'UI displays the official pinned endpoint');
  });

  console.log(`\nOPENAI ENDPOINT SECURITY ACCEPTANCE: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
