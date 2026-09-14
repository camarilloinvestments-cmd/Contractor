// Workstream M — provider factory + settings helpers (v1.2.0).
import { prisma } from '@/lib/prisma';
import { decryptSecret } from '@/lib/crypto';
import { IPPayProvider } from './ippay';
import type { PaymentProvider, ProviderConfig } from './provider';

export function getProvider(name: string): PaymentProvider {
  switch (name) {
    case 'IPPAY':
      return new IPPayProvider();
    default:
      throw new Error(`Unsupported payment provider: ${name}`);
  }
}

export async function getPaymentSettings() {
  return prisma.paymentSettings.findUnique({ where: { id: 'default' } });
}

// Build a decrypted provider config from stored settings. Secrets are decrypted
// only here, in-process, and never returned to any client.
export function toProviderConfig(s: {
  environment: string;
  merchantId: string | null;
  terminalId: string | null;
  apiUsernameEncrypted: string | null;
  apiPasswordEncrypted: string | null;
}): ProviderConfig {
  return {
    environment: s.environment as ProviderConfig['environment'],
    merchantId: s.merchantId,
    terminalId: s.terminalId,
    apiUsername: s.apiUsernameEncrypted ? decryptSecret(s.apiUsernameEncrypted) : null,
    apiPassword: s.apiPasswordEncrypted ? decryptSecret(s.apiPasswordEncrypted) : null,
  };
}

// Browser-safe projection of settings (no secrets, only presence flags).
export function maskPaymentSettings(s: any) {
  if (!s) return null;
  const { apiUsernameEncrypted, apiPasswordEncrypted, ...rest } = s;
  return {
    ...rest,
    hasApiUsername: !!apiUsernameEncrypted,
    hasApiPassword: !!apiPasswordEncrypted,
  };
}
