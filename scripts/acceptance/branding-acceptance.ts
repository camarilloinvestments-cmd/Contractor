// Phase 1.3 acceptance — branding local-storage fallback (no DB, no S3).
// Verifies: type/size validation, path-traversal rejection, and a local
// save -> read -> delete round-trip proving persistence to data/branding.
import assert from 'assert';

// Ensure local mode (no bucket).
delete process.env.AWS_BUCKET_NAME;

import {
  validateLogo,
  safeLocalFilename,
  isLocalStoragePath,
  saveLogo,
  readLocalLogo,
  deleteLogo,
  isS3Configured,
  LOCAL_SCHEME,
} from '../../lib/branding-storage';

let pass = 0, fail = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => { pass++; console.log(`  PASS  ${name}`); })
    .catch((e) => { fail++; console.log(`  FAIL  ${name}: ${e?.message || e}`); });
}

async function main() {
  console.log('Branding local-storage acceptance');

  await check('S3 not configured -> local mode', () => {
    assert.strictEqual(isS3Configured(), false);
  });

  await check('validateLogo accepts png within size', () => {
    assert.deepStrictEqual(validateLogo('image/png', 1024), { ok: true });
  });
  await check('validateLogo rejects unsupported type', () => {
    const r = validateLogo('application/pdf', 1024);
    assert.strictEqual(r.ok, false);
  });
  await check('validateLogo rejects oversize', () => {
    const r = validateLogo('image/png', 6 * 1024 * 1024);
    assert.strictEqual(r.ok, false);
  });
  await check('validateLogo rejects empty', () => {
    const r = validateLogo('image/png', 0);
    assert.strictEqual(r.ok, false);
  });

  await check('safeLocalFilename rejects traversal ../', () => {
    assert.strictEqual(safeLocalFilename('local:../../etc/passwd'), null);
  });
  await check('safeLocalFilename rejects absolute path', () => {
    assert.strictEqual(safeLocalFilename('local:/etc/passwd'), null);
  });
  await check('safeLocalFilename rejects foreign name', () => {
    assert.strictEqual(safeLocalFilename('local:evil.php'), null);
  });
  await check('safeLocalFilename accepts well-formed name', () => {
    const n = safeLocalFilename('local:logo-123.png');
    assert.strictEqual(n, 'logo-123.png');
  });

  // Round-trip: save a tiny PNG, read it back, then delete.
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  let savedPath = '';
  await check('saveLogo writes to local storage (local: scheme)', async () => {
    const saved = await saveLogo(PNG, 'image/png');
    savedPath = saved.logoStoragePath;
    assert.ok(isLocalStoragePath(saved.logoStoragePath), 'expected local: scheme');
    assert.ok(saved.logoUrl.startsWith('/api/branding/logo/'), 'expected local serving URL');
    assert.strictEqual(saved.logoContentType, 'image/png');
  });
  await check('readLocalLogo returns identical bytes (persisted)', async () => {
    const r = await readLocalLogo(savedPath);
    assert.ok(r, 'expected read result');
    assert.strictEqual(r!.contentType, 'image/png');
    assert.ok(r!.buffer.equals(PNG), 'bytes must match what was written');
  });
  await check('deleteLogo removes the file', async () => {
    await deleteLogo(savedPath);
    const r = await readLocalLogo(savedPath);
    assert.strictEqual(r, null, 'file should be gone after delete');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
