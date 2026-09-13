// Email/SMTP settings accessor (Phase 1 / v1.1.0).
//
// The SMTP password is stored ONLY as AES-256-GCM ciphertext (lib/crypto.ts).
// getEmailSettings never returns the plaintext password or the ciphertext to the
// caller by default; use getDecryptedPassword() explicitly (server-side only)
// when actually sending mail. Saving a new password encrypts it fail-closed.
import { prisma } from '@/lib/prisma';
import { encryptSecret, isEncryptionAvailable } from '@/lib/crypto';

export const EMAIL_SETTINGS_ID = 'default';

export type EmailSettingsPublic = {
  id: string;
  enabled: boolean;
  host: string | null;
  port: number | null;
  secure: boolean;
  username: string | null;
  hasPassword: boolean; // never expose the password itself
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;
};

export type EmailSettingsInput = {
  enabled?: boolean;
  host?: string | null;
  port?: number | null;
  secure?: boolean;
  username?: string | null;
  password?: string | null; // plaintext from the form; empty/undefined = keep existing
  fromName?: string | null;
  fromEmail?: string | null;
  replyTo?: string | null;
};

function toPublic(row: {
  id: string;
  enabled: boolean;
  host: string | null;
  port: number | null;
  secure: boolean;
  username: string | null;
  passwordEncrypted: string | null;
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;
}): EmailSettingsPublic {
  return {
    id: row.id,
    enabled: row.enabled,
    host: row.host,
    port: row.port,
    secure: row.secure,
    username: row.username,
    hasPassword: !!row.passwordEncrypted,
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    replyTo: row.replyTo,
  };
}

export async function getEmailSettings(): Promise<EmailSettingsPublic | null> {
  try {
    const row = await prisma.emailSettings.findUnique({ where: { id: EMAIL_SETTINGS_ID } });
    return row ? toPublic(row) : null;
  } catch {
    return null;
  }
}

// Returns the raw row including ciphertext (server-internal use only).
export async function getEmailSettingsRaw() {
  return prisma.emailSettings.findUnique({ where: { id: EMAIL_SETTINGS_ID } });
}

export async function saveEmailSettings(input: EmailSettingsInput): Promise<EmailSettingsPublic> {
  const data: Record<string, unknown> = {
    enabled: input.enabled,
    host: input.host,
    port: input.port,
    secure: input.secure,
    username: input.username,
    fromName: input.fromName,
    fromEmail: input.fromEmail,
    replyTo: input.replyTo,
  };

  // Only touch the password when a non-empty new value is provided.
  if (input.password != null && input.password.length > 0) {
    if (!isEncryptionAvailable()) {
      throw new Error(
        'Cannot store SMTP password: APP_ENCRYPTION_KEY is not configured (fail-closed).'
      );
    }
    data.passwordEncrypted = encryptSecret(input.password);
  }

  // Remove undefined keys so we don't overwrite existing values with null on partial updates.
  Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);

  const row = await prisma.emailSettings.upsert({
    where: { id: EMAIL_SETTINGS_ID },
    create: { id: EMAIL_SETTINGS_ID, ...data },
    update: { ...data },
  });
  return toPublic(row);
}
