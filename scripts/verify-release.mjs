#!/usr/bin/env node
// verify-release.mjs
// Zero-dependency, standalone mirror of lib/updates/manifest.ts +
// lib/updates/index.ts signature policy, used by scripts/os1-upgrade.sh to
// verify a staged release package BEFORE any build/migration/cutover.
//
// It re-implements (does not import TS) the SAME verification the app performs:
//   - parse the staged manifest.json (data/updates/staging/manifest.json)
//   - SHA-256 checksum the staged package (constant-time compare)
//   - verify the manifest signature against a PINNED trusted public key
//     (RSA-SHA256 or ed25519) over canonical, signature-stripped, key-sorted
//     bytes
//   - enforce signed-by-default policy (a pinned key forces requireSignature;
//     otherwise required unless UPDATE_ALLOW_UNSIGNED=true)
//   - check the manifest channel matches --channel (when given)
//   - confirm the manifest pins a target commit
//
// On success prints a single JSON line: {"ok":true,"version","commit","channel"}
// On any failure: prints the reason to stderr and exits 1 (fail-closed).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function fail(msg) { process.stderr.write(`verify-release: ${msg}\n`); process.exit(1); }

// ---- args ----
let channel = '';
let refMode = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--channel') channel = argv[++i] || '';
  else if (a.startsWith('--channel=')) channel = a.slice('--channel='.length);
  else if (a === '--ref') refMode = true, i++; // ref value is informational here
  else if (a.startsWith('--ref=')) refMode = true;
}

const ROOT = process.cwd();
const STAGING = path.join(ROOT, 'data', 'updates', 'staging');
const manifestPath = path.join(STAGING, 'manifest.json');

if (!fs.existsSync(manifestPath)) fail(`staged manifest not found at ${manifestPath}`);

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {
  fail(`manifest is not valid JSON: ${e?.message ?? e}`);
}
if (!manifest || typeof manifest !== 'object') fail('manifest is not a JSON object');
for (const req of ['version', 'filename', 'sha256']) {
  if (!manifest[req]) fail(`manifest missing required field: ${req}`);
}

// ---- checksum the staged package (basename only; never escape staging) ----
const pkgPath = path.join(STAGING, path.basename(manifest.filename));
if (!fs.existsSync(pkgPath)) fail(`staged package not found at ${pkgPath}`);
const buf = fs.readFileSync(pkgPath);
const actual = crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
const expected = String(manifest.sha256).trim().toLowerCase();
if (actual.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
  fail('SHA-256 checksum mismatch — package is corrupt or tampered');
}

// ---- canonical signed bytes: drop signature fields, sort keys ----
function canonicalBytes(m) {
  const { signature, signatureAlgorithm, ...rest } = m;
  const sorted = {};
  for (const k of Object.keys(rest).sort()) sorted[k] = rest[k];
  return Buffer.from(JSON.stringify(sorted), 'utf8');
}

// ---- pinned trusted public key (env PEM or file) ----
function pinnedPublicKeyPem() {
  const pem = process.env.UPDATE_SIGNING_PUBLIC_KEY_PEM;
  if (pem && pem.includes('BEGIN') && pem.includes('KEY')) return pem;
  const file = process.env.UPDATE_SIGNING_PUBLIC_KEY_FILE ||
    path.join(ROOT, 'config', 'update-signing-key.pem');
  try {
    if (fs.existsSync(file)) {
      const txt = fs.readFileSync(file, 'utf8');
      if (txt.includes('BEGIN') && txt.includes('KEY')) return txt;
    }
  } catch { /* ignore */ }
  return null;
}

function verifySignature(m, publicKeyPem) {
  if (!m.signature) return false;
  const data = canonicalBytes(m);
  const sig = Buffer.from(m.signature, 'base64');
  try {
    const algo = (m.signatureAlgorithm || 'RSA-SHA256').toLowerCase();
    if (algo === 'ed25519') return crypto.verify(null, data, publicKeyPem, sig);
    const v = crypto.createVerify('RSA-SHA256');
    v.update(data); v.end();
    return v.verify(publicKeyPem, sig);
  } catch { return false; }
}

const pinned = pinnedPublicKeyPem();
const allowUnsigned = process.env.UPDATE_ALLOW_UNSIGNED === 'true';
const publicKeyPem = pinned || null;
const requireSignature = pinned ? true : !allowUnsigned;

if (requireSignature) {
  if (!publicKeyPem) fail('signature required but no trusted public key is pinned');
  if (!manifest.signature) fail('signature required but manifest is unsigned');
  if (!verifySignature(manifest, publicKeyPem)) fail('manifest signature verification failed');
} else if (publicKeyPem && manifest.signature) {
  if (!verifySignature(manifest, publicKeyPem)) fail('manifest signature verification failed');
}

// ---- channel match ----
if (channel && manifest.channel && String(manifest.channel) !== channel) {
  fail(`manifest channel '${manifest.channel}' does not match requested '${channel}'`);
}

// ---- target commit must be pinned ----
if (!manifest.commit) fail('manifest does not pin a target commit');

process.stdout.write(JSON.stringify({
  ok: true,
  version: manifest.version,
  commit: manifest.commit,
  channel: manifest.channel || channel || null,
}) + '\n');
process.exit(0);
