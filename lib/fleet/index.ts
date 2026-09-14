// Increment 8 — fleet provider factory + settings helpers.
import { prisma } from '@/lib/prisma';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import { GeotabProvider, MockGeotabProvider } from './geotab';
import type { FleetTelemetryProvider, FleetProviderConfig } from './provider';

export const FLEET_SETTINGS_ID = 'default';

// Fixture mode is selected by the sentinel database value "MOCK" so the Geotab
// connector can be demonstrated without live credentials.
export function isMock(cfg: { database: string | null } | null | undefined): boolean {
  return (cfg?.database || '').trim().toUpperCase() === 'MOCK';
}

export function getFleetProvider(cfg: { database: string | null } | null): FleetTelemetryProvider {
  return isMock(cfg) ? new MockGeotabProvider() : new GeotabProvider();
}

export async function getFleetSettings() {
  return prisma.fleetProviderSettings.findUnique({ where: { id: FLEET_SETTINGS_ID } });
}

// Decrypt stored settings into an in-process provider config. Secrets are only
// ever decrypted here and never returned to any client.
export function toProviderConfig(s: {
  database: string | null;
  username: string | null;
  credentialEncrypted: string | null;
  sessionIdEncrypted: string | null;
  serverUrl: string | null;
}): FleetProviderConfig {
  return {
    database: s.database,
    username: s.username,
    credential: s.credentialEncrypted ? decryptSecret(s.credentialEncrypted) : null,
    sessionId: s.sessionIdEncrypted ? decryptSecret(s.sessionIdEncrypted) : null,
    serverUrl: s.serverUrl,
  };
}

export function encryptOrNull(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  return encryptSecret(plaintext);
}

// Browser-safe projection: no secrets, only presence flags.
export function maskFleetSettings(s: any) {
  if (!s) {
    return {
      id: FLEET_SETTINGS_ID,
      provider: 'GEOTAB',
      enabled: false,
      syncEnabled: false,
      database: null,
      username: null,
      serverUrl: null,
      hasCredential: false,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastSyncError: null,
      lastConnectionStatus: 'UNTESTED',
    };
  }
  const { credentialEncrypted, sessionIdEncrypted, ...rest } = s;
  return {
    ...rest,
    hasCredential: !!credentialEncrypted,
  };
}
