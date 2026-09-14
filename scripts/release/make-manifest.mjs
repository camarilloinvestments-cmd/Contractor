#!/usr/bin/env node
// Build (and optionally sign) a release manifest.json for a package tarball.
//
// The canonical-bytes logic here MUST stay identical to
// lib/updates/manifest.ts -> canonicalManifestBytes(), otherwise the in-app
// verifier will reject a manifest this script signed. Canonical form = the
// manifest object WITHOUT signature/signatureAlgorithm, keys sorted, compact
// JSON (no whitespace).
//
// Usage:
//   node scripts/release/make-manifest.mjs \
//     --package dist/os1-fiber-track-pro-v1.2.0.tar.gz \
//     --version 1.2.0 --commit <sha> --channel STABLE \
//     --min 1.0.0 --migration "0000..0010" \
//     --notes-file release-notes.md \
//     [--private-key private.pem] [--algo RSA-SHA256|ed25519] \
//     --out dist/manifest.json
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const pkgPath = arg('package');
if (!pkgPath || !fs.existsSync(pkgPath)) { console.error('Missing or invalid --package'); process.exit(1); }
const version = arg('version');
if (!version) { console.error('Missing --version'); process.exit(1); }

const buf = fs.readFileSync(pkgPath);
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

const manifest = {
  product: 'os1-fiber-track-pro',
  version,
  buildDate: new Date().toISOString(),
  commit: arg('commit', null),
  minimumSupportedVersion: arg('min', null),
  migration: arg('migration', null),
  filename: path.basename(pkgPath),
  sha256,
  channel: arg('channel', 'STABLE'),
};
// Drop null-valued optional fields so canonical bytes stay clean.
for (const k of Object.keys(manifest)) if (manifest[k] === null) delete manifest[k];

function canonicalBytes(m) {
  const { signature, signatureAlgorithm, ...rest } = m;
  const sorted = {};
  for (const k of Object.keys(rest).sort()) sorted[k] = rest[k];
  return Buffer.from(JSON.stringify(sorted), 'utf8');
}

const keyPath = arg('private-key');
if (keyPath) {
  if (!fs.existsSync(keyPath)) { console.error('Private key not found:', keyPath); process.exit(1); }
  const keyPem = fs.readFileSync(keyPath, 'utf8');
  const algo = arg('algo', 'RSA-SHA256');
  const data = canonicalBytes(manifest);
  let sig;
  if (algo.toLowerCase() === 'ed25519') {
    sig = crypto.sign(null, data, keyPem);
  } else {
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(data); signer.end();
    sig = signer.sign(keyPem);
  }
  manifest.signatureAlgorithm = algo;
  manifest.signature = sig.toString('base64');
}

const outPath = arg('out', 'manifest.json');
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${outPath}`);
console.log(`  version=${manifest.version} sha256=${sha256}`);
console.log(`  signed=${keyPath ? 'yes (' + manifest.signatureAlgorithm + ')' : 'no'}`);
