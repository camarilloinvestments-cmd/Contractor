// AES-256-GCM encryption for secrets at rest (Phase 1 / v1.1.0).
//
// Used to encrypt the SMTP password before it is stored in EmailSettings.
// Ruling #9 constraints enforced here:
//   * The key comes ONLY from APP_ENCRYPTION_KEY (never committed to source).
//   * There is NO plaintext fallback. If the key is missing/invalid, encrypt and
//     decrypt both throw (fail closed) so nothing is ever written or read in the
//     clear.
//   * The key value is never logged or returned.
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce recommended for GCM
const KEY_LENGTH = 32; // 256-bit key
const FORMAT_PREFIX = 'v1';

export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionKeyError';
  }
}

// Resolve the 32-byte key from APP_ENCRYPTION_KEY.
// Accepts a 64-char hex string, or a 44-char base64 string, or a >=32-char raw
// passphrase (hashed to 32 bytes via SHA-256 as a convenience).
function resolveKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw || raw.trim().length === 0) {
    throw new EncryptionKeyError(
      'APP_ENCRYPTION_KEY is not set. Email/SMTP credential encryption is disabled (fail-closed).'
    );
  }
  const value = raw.trim();

  // 64 hex chars => 32 bytes
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, 'hex');
  }
  // base64 that decodes to exactly 32 bytes
  try {
    const b = Buffer.from(value, 'base64');
    if (b.length === KEY_LENGTH) return b;
  } catch {
    /* ignore, fall through */
  }
  // Fallback: derive a stable 32-byte key from a sufficiently long passphrase.
  if (value.length >= KEY_LENGTH) {
    return crypto.createHash('sha256').update(value, 'utf8').digest();
  }
  throw new EncryptionKeyError(
    'APP_ENCRYPTION_KEY is invalid. Provide 64 hex chars (32 bytes), 32-byte base64, or a passphrase of at least 32 characters.'
  );
}

// Returns true when a usable key is configured (does NOT reveal the key).
export function isEncryptionAvailable(): boolean {
  try {
    resolveKey();
    return true;
  } catch {
    return false;
  }
}

// Encrypt a UTF-8 string. Output: "v1:<iv_b64>:<tag_b64>:<ciphertext_b64>".
export function encryptSecret(plaintext: string): string {
  const key = resolveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    FORMAT_PREFIX,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

// Decrypt a value produced by encryptSecret. Throws on any tampering or on a
// missing/incorrect key (fail closed).
export function decryptSecret(payload: string): string {
  const key = resolveKey();
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== FORMAT_PREFIX) {
    throw new EncryptionKeyError('Ciphertext format is not recognized.');
  }
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ciphertext = Buffer.from(parts[3], 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
