// OpenAI integration settings for AI Help (singleton row).
//
// The API key is stored ONLY as AES-256-GCM ciphertext (lib/crypto.ts). Public
// accessors expose a boolean hasApiKey flag and NEVER return the key (or its
// ciphertext) to the browser. getDecryptedApiKey() (server-only) decrypts
// fail-closed at request time. Business logic is never hardcoded to a model
// name — normalModel + fallbackModel are configurable.
import { prisma } from '@/lib/prisma';
import { encryptSecret, decryptSecret, isEncryptionAvailable } from '@/lib/crypto';

export const AI_INTAKE_SETTINGS_ID = 'default';

export type AiIntakeSettingsPublic = {
  id: string;
  enabled: boolean;
  hasApiKey: boolean; // never expose the key itself
  apiBase: string | null;
  normalModel: string;
  fallbackModel: string;
  schemaVersion: string;
  lastSuccessAt: string | null;
  lastModelUsed: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
};

export type AiIntakeSettingsInput = {
  enabled?: boolean;
  apiKey?: string | null; // plaintext from the form; empty/undefined = keep existing
  clearApiKey?: boolean;
  apiBase?: string | null;
  normalModel?: string | null;
  fallbackModel?: string | null;
};

type Row = {
  id: string;
  enabled: boolean;
  apiKeyEncrypted: string | null;
  apiBase: string | null;
  normalModel: string;
  fallbackModel: string;
  schemaVersion: string;
  lastSuccessAt: Date | null;
  lastModelUsed: string | null;
  lastError: string | null;
  lastErrorAt: Date | null;
};

function toPublic(row: Row): AiIntakeSettingsPublic {
  return {
    id: row.id,
    enabled: row.enabled,
    hasApiKey: !!row.apiKeyEncrypted,
    apiBase: row.apiBase,
    normalModel: row.normalModel,
    fallbackModel: row.fallbackModel,
    schemaVersion: row.schemaVersion,
    lastSuccessAt: row.lastSuccessAt ? row.lastSuccessAt.toISOString() : null,
    lastModelUsed: row.lastModelUsed,
    lastError: row.lastError,
    lastErrorAt: row.lastErrorAt ? row.lastErrorAt.toISOString() : null,
  };
}

export async function getAiIntakeSettings(): Promise<AiIntakeSettingsPublic | null> {
  try {
    const row = await prisma.aiIntakeSettings.findUnique({ where: { id: AI_INTAKE_SETTINGS_ID } });
    return row ? toPublic(row as Row) : null;
  } catch {
    return null;
  }
}

export async function getAiIntakeSettingsRaw() {
  return prisma.aiIntakeSettings.findUnique({ where: { id: AI_INTAKE_SETTINGS_ID } });
}

// Server-only: decrypt the stored key. Fail-closed if ciphertext exists but the
// encryption key is unavailable. Never logs the plaintext.
export function getDecryptedApiKey(row: { apiKeyEncrypted: string | null }): string | null {
  if (!row.apiKeyEncrypted) return null;
  if (!isEncryptionAvailable()) {
    throw new Error('APP_ENCRYPTION_KEY is not configured; cannot decrypt the stored OpenAI API key.');
  }
  return decryptSecret(row.apiKeyEncrypted);
}

export async function saveAiIntakeSettings(input: AiIntakeSettingsInput): Promise<AiIntakeSettingsPublic> {
  const data: Record<string, unknown> = {
    enabled: input.enabled,
    apiBase: input.apiBase,
    normalModel: input.normalModel,
    fallbackModel: input.fallbackModel,
  };

  if (input.clearApiKey) {
    data.apiKeyEncrypted = null;
  } else if (input.apiKey != null && input.apiKey.length > 0) {
    if (!isEncryptionAvailable()) {
      throw new Error('Cannot store the OpenAI API key: APP_ENCRYPTION_KEY is not configured (fail-closed).');
    }
    data.apiKeyEncrypted = encryptSecret(input.apiKey);
  }

  Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);

  const row = await prisma.aiIntakeSettings.upsert({
    where: { id: AI_INTAKE_SETTINGS_ID },
    create: { id: AI_INTAKE_SETTINGS_ID, ...data },
    update: { ...data },
  });
  return toPublic(row as Row);
}

export async function recordAiSuccess(modelUsed: string) {
  await prisma.aiIntakeSettings.update({
    where: { id: AI_INTAKE_SETTINGS_ID },
    data: { lastSuccessAt: new Date(), lastModelUsed: modelUsed, lastError: null, lastErrorAt: null },
  }).catch(() => {});
}

export async function recordAiError(message: string) {
  // Never store secrets in the error text; callers pass sanitized messages.
  await prisma.aiIntakeSettings.update({
    where: { id: AI_INTAKE_SETTINGS_ID },
    data: { lastError: message.slice(0, 500), lastErrorAt: new Date() },
  }).catch(() => {});
}
