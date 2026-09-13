import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import type { UserRole } from '@prisma/client';

// TOTP configuration: 30s step, 6 digits, allow +/-1 window for clock drift.
authenticator.options = { step: 30, digits: 6, window: 1 };

export const RECOVERY_CODE_COUNT = 10;

/** Generate a fresh base32 TOTP secret. */
export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

/** Build the otpauth:// URI used to render the enrollment QR code. */
export function buildOtpAuthUri(secret: string, accountEmail: string, issuer: string): string {
  return authenticator.keyuri(accountEmail, issuer, secret);
}

/** Render an otpauth URI to a PNG data URL for display. */
export async function otpAuthQrDataUrl(otpauthUri: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri, { margin: 1, width: 240 });
}

/** Verify a 6-digit TOTP token against a base32 secret. */
export function verifyTotp(token: string, secret: string): boolean {
  const clean = (token || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  try {
    return authenticator.verify({ token: clean, secret });
  } catch {
    return false;
  }
}

/** Encrypt a TOTP secret for storage (fail-closed via lib/crypto). */
export function encryptTotpSecret(secret: string): string {
  return encryptSecret(secret);
}

/** Decrypt a stored TOTP secret. */
export function decryptTotpSecret(payload: string): string {
  return decryptSecret(payload);
}

/** Generate N human-friendly recovery codes (format XXXX-XXXX-XXXX, base32 chars). */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = Array.from({ length: 12 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`);
  }
  return codes;
}

/** Normalize a recovery code for comparison (uppercase, strip separators/space). */
export function normalizeRecoveryCode(code: string): string {
  return (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Hash a recovery code for storage (never store plaintext). */
export async function hashRecoveryCode(code: string): Promise<string> {
  return bcrypt.hash(normalizeRecoveryCode(code), 10);
}

/**
 * Replace all recovery codes for a user with freshly hashed ones.
 * Returns the plaintext codes to display ONCE. Old codes are invalidated.
 */
export async function replaceRecoveryCodes(userId: string, count = RECOVERY_CODE_COUNT): Promise<string[]> {
  const codes = generateRecoveryCodes(count);
  const hashes = await Promise.all(codes.map(hashRecoveryCode));
  await prisma.$transaction([
    prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
    prisma.mfaRecoveryCode.createMany({
      data: hashes.map((codeHash) => ({ userId, codeHash })),
    }),
  ]);
  return codes;
}

/**
 * Attempt to consume a single-use recovery code. Returns true if a matching
 * unused code was found and marked used. Constant-ish work regardless of match.
 */
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) return false;
  const candidates = await prisma.mfaRecoveryCode.findMany({
    where: { userId, usedAt: null },
  });
  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const match = await bcrypt.compare(normalized, candidate.codeHash);
    if (match) {
      const res = await prisma.mfaRecoveryCode.updateMany({
        where: { id: candidate.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      return res.count === 1;
    }
  }
  return false;
}

/** Count unused recovery codes remaining for a user. */
export async function countRemainingRecoveryCodes(userId: string): Promise<number> {
  return prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } });
}

/** Whether MFA is required for a given role, per policy. Defaults ADMIN=true. */
export async function isMfaRequiredForRole(role: UserRole): Promise<boolean> {
  const policy = await prisma.mfaPolicy.findUnique({ where: { role } });
  if (policy) return policy.required;
  return role === 'ADMIN';
}
