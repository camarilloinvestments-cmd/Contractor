// Release-package manifest parsing and cryptographic verification.
// The updater must NEVER install an unverified package: callers verify the
// SHA-256 checksum (always) and, when a public key is configured, the signature.
import crypto from 'crypto';

export interface ReleaseManifest {
  product?: string;
  version: string;
  buildDate?: string;
  commit?: string;
  minimumSupportedVersion?: string;
  migration?: string | { from?: string; to?: string; notes?: string };
  filename: string;
  sha256: string;
  channel?: string;
  signature?: string; // base64 signature of the canonical manifest (optional)
  signatureAlgorithm?: string; // e.g. RSA-SHA256 or ed25519
}

export function parseManifest(text: string): ReleaseManifest {
  const obj = JSON.parse(text);
  if (!obj || typeof obj !== 'object') throw new Error('Manifest is not a JSON object.');
  if (!obj.version) throw new Error('Manifest missing required field: version');
  if (!obj.filename) throw new Error('Manifest missing required field: filename');
  if (!obj.sha256) throw new Error('Manifest missing required field: sha256');
  return obj as ReleaseManifest;
}

export function sha256Hex(buf: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function verifyChecksum(buf: Buffer | Uint8Array, expectedSha256: string): boolean {
  const actual = sha256Hex(buf).toLowerCase();
  const expected = expectedSha256.trim().toLowerCase();
  if (actual.length !== expected.length) return false;
  // constant-time comparison
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

// Canonical bytes signed by the publisher: the manifest object WITHOUT the
// signature fields, with keys sorted, so signing/verification are stable.
export function canonicalManifestBytes(manifest: ReleaseManifest): Buffer {
  const { signature, signatureAlgorithm, ...rest } = manifest;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(rest).sort()) sorted[k] = (rest as Record<string, unknown>)[k];
  return Buffer.from(JSON.stringify(sorted), 'utf8');
}

export function verifySignature(manifest: ReleaseManifest, publicKeyPem: string): boolean {
  if (!manifest.signature) return false;
  const data = canonicalManifestBytes(manifest);
  const sig = Buffer.from(manifest.signature, 'base64');
  try {
    const algo = manifest.signatureAlgorithm || 'RSA-SHA256';
    if (algo.toLowerCase() === 'ed25519') {
      return crypto.verify(null, data, publicKeyPem, sig);
    }
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(data);
    verifier.end();
    return verifier.verify(publicKeyPem, sig);
  } catch {
    return false;
  }
}

export interface VerificationResult {
  ok: boolean;
  checksumOk: boolean;
  signatureOk: boolean | null; // null = not attempted (no key / no signature)
  errors: string[];
}

// Full verification gate. requireSignature makes a missing/invalid signature fatal.
export function verifyPackage(
  buf: Buffer | Uint8Array,
  manifest: ReleaseManifest,
  opts: { publicKeyPem?: string | null; requireSignature?: boolean }
): VerificationResult {
  const errors: string[] = [];
  const checksumOk = verifyChecksum(buf, manifest.sha256);
  if (!checksumOk) errors.push('SHA-256 checksum mismatch \u2014 package is corrupt or tampered.');

  let signatureOk: boolean | null = null;
  if (opts.publicKeyPem) {
    if (!manifest.signature) {
      signatureOk = false;
      if (opts.requireSignature) errors.push('Signature required but manifest is unsigned.');
    } else {
      signatureOk = verifySignature(manifest, opts.publicKeyPem);
      if (!signatureOk) errors.push('Package signature verification failed.');
    }
  } else if (opts.requireSignature) {
    errors.push('Signature required but no public key is configured.');
  }

  const ok = checksumOk && (opts.requireSignature ? signatureOk === true : true);
  return { ok, checksumOk, signatureOk, errors };
}
