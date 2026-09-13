#!/usr/bin/env node
// Startup diagnostic: reports whether APP_ENCRYPTION_KEY is a USABLE encryption
// key, WITHOUT ever printing the key itself. Mirrors the validation performed by
// resolveKey() in lib/crypto.ts so the container log matches the app's own view.
//
// Output is exactly one of:
//   [entrypoint] Encryption configuration: AVAILABLE
//   [entrypoint] Encryption configuration: MISSING
// The key value is never logged.
const raw = process.env.APP_ENCRYPTION_KEY;

function usable(v) {
  if (!v || v.trim().length === 0) return false;
  const s = v.trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return true; // 32 bytes hex
  try {
    if (Buffer.from(s, 'base64').length === 32) return true; // 32 bytes base64
  } catch {
    /* ignore */
  }
  return s.length >= 32; // passphrase hashed to 32 bytes
}

console.log(
  `[entrypoint] Encryption configuration: ${usable(raw) ? 'AVAILABLE' : 'MISSING'}`
);
