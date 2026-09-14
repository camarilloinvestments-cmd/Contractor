// Email/SMTP settings accessor (Phase 1 / v1.1.0, extended Phase 2 / v1.2.0).
//
// Secrets (SMTP password, OAuth2 client secret, OAuth2 refresh token) are stored
// ONLY as AES-256-GCM ciphertext (lib/crypto.ts). The public accessors never
// return plaintext OR ciphertext; they expose boolean "has*" presence flags
// instead. getDecryptedSecrets() (server-side only) decrypts fail-closed when
// actually sending mail. Saving new secrets encrypts them fail-closed.
import { prisma } from '@/lib/prisma';
import { encryptSecret, decryptSecret, isEncryptionAvailable } from '@/lib/crypto';

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
  // Phase 2 provider fields.
  provider: string | null;
  transportMode: string | null;
  authMethod: string | null;
  oauthClientId: string | null;
  oauthTenantId: string | null;
  hasOauthClientSecret: boolean; // never expose the secret itself
  hasOauthRefreshToken: boolean; // never expose the token itself
};

export type EmailSettingsInput = {
  enabled?: boolean;
  host?: string | null;
  port?: number | null;
  secure?: boolean;
  username?: string | null;
  password?: string | null; // plaintext from the form; empty/undefined = keep existing
  clearPassword?: boolean; // explicit request to remove the stored password
  fromName?: string | null;
  fromEmail?: string | null;
  replyTo?: string | null;
  // Phase 2 provider fields.
  provider?: string | null;
  transportMode?: string | null;
  authMethod?: string | null;
  oauthClientId?: string | null;
  oauthTenantId?: string | null;
  oauthClientSecret?: string | null; // plaintext from the form; empty/undefined = keep existing
  clearOauthClientSecret?: boolean;
  oauthRefreshToken?: string | null; // plaintext from the form; empty/undefined = keep existing
  clearOauthRefreshToken?: boolean;
};

type EmailSettingsRow = {
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
  provider: string | null;
  transportMode: string | null;
  authMethod: string | null;
  oauthClientId: string | null;
  oauthClientSecretEncrypted: string | null;
  oauthRefreshTokenEncrypted: string | null;
  oauthTenantId: string | null;
};

function toPublic(row: EmailSettingsRow): EmailSettingsPublic {
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
    provider: row.provider,
    transportMode: row.transportMode,
    authMethod: row.authMethod,
    oauthClientId: row.oauthClientId,
    oauthTenantId: row.oauthTenantId,
    hasOauthClientSecret: !!row.oauthClientSecretEncrypted,
    hasOauthRefreshToken: !!row.oauthRefreshTokenEncrypted,
  };
}

export async function getEmailSettings(): Promise<EmailSettingsPublic | null> {
  try {
    const row = await prisma.emailSettings.findUnique({ where: { id: EMAIL_SETTINGS_ID } });
    return row ? toPublic(row as EmailSettingsRow) : null;
  } catch {
    return null;
  }
}

// Returns the raw row including ciphertext (server-internal use only).
export async function getEmailSettingsRaw() {
  return prisma.emailSettings.findUnique({ where: { id: EMAIL_SETTINGS_ID } });
}

export type DecryptedEmailSecrets = {
  password: string | null;
  oauthClientSecret: string | null;
  oauthRefreshToken: string | null;
};

// Decrypts the stored secrets for actual sending. Fail-closed: throws if the
// encryption key is unavailable but ciphertext exists. Never logs the plaintext.
export function decryptEmailSecrets(row: {
  passwordEncrypted: string | null;
  oauthClientSecretEncrypted: string | null;
  oauthRefreshTokenEncrypted: string | null;
}): DecryptedEmailSecrets {
  const anyCipher =
    !!row.passwordEncrypted || !!row.oauthClientSecretEncrypted || !!row.oauthRefreshTokenEncrypted;
  if (anyCipher && !isEncryptionAvailable()) {
    throw new Error('APP_ENCRYPTION_KEY is not configured; cannot decrypt stored email credentials.');
  }
  return {
    password: row.passwordEncrypted ? decryptSecret(row.passwordEncrypted) : null,
    oauthClientSecret: row.oauthClientSecretEncrypted ? decryptSecret(row.oauthClientSecretEncrypted) : null,
    oauthRefreshToken: row.oauthRefreshTokenEncrypted ? decryptSecret(row.oauthRefreshTokenEncrypted) : null,
  };
}

function encryptOrThrow(plaintext: string, label: string): string {
  if (!isEncryptionAvailable()) {
    throw new Error(`Cannot store ${label}: APP_ENCRYPTION_KEY is not configured (fail-closed).`);
  }
  return encryptSecret(plaintext);
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
    provider: input.provider,
    transportMode: input.transportMode,
    authMethod: input.authMethod,
    oauthClientId: input.oauthClientId,
    oauthTenantId: input.oauthTenantId,
  };

  // SMTP password.
  if (input.clearPassword) {
    data.passwordEncrypted = null;
  } else if (input.password != null && input.password.length > 0) {
    data.passwordEncrypted = encryptOrThrow(input.password, 'SMTP password');
  }

  // OAuth2 client secret.
  if (input.clearOauthClientSecret) {
    data.oauthClientSecretEncrypted = null;
  } else if (input.oauthClientSecret != null && input.oauthClientSecret.length > 0) {
    data.oauthClientSecretEncrypted = encryptOrThrow(input.oauthClientSecret, 'OAuth2 client secret');
  }

  // OAuth2 refresh token.
  if (input.clearOauthRefreshToken) {
    data.oauthRefreshTokenEncrypted = null;
  } else if (input.oauthRefreshToken != null && input.oauthRefreshToken.length > 0) {
    data.oauthRefreshTokenEncrypted = encryptOrThrow(input.oauthRefreshToken, 'OAuth2 refresh token');
  }

  // Remove undefined keys so we don't overwrite existing values with null on partial updates.
  Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);

  const row = await prisma.emailSettings.upsert({
    where: { id: EMAIL_SETTINGS_ID },
    create: { id: EMAIL_SETTINGS_ID, ...data },
    update: { ...data },
  });
  return toPublic(row as EmailSettingsRow);
}
