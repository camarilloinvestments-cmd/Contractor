// Update-center settings helpers: single source for reading/masking the
// UpdateSettings singleton and building an authenticated GitHub config.
import path from 'path';
import { prisma } from '@/lib/prisma';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import { APP_VERSION, PRODUCT_SLUG } from '@/lib/version';
import type { GithubConfig } from './github';
import type { ReleaseChannel } from './semver';

export const UPDATE_SETTINGS_ID = 'default';

// Staging lives inside the project data dir (never public) so downloaded
// packages are isolated from application code until verified + installed.
export const UPDATE_STAGING_DIR = path.join(process.cwd(), 'data', 'updates', 'staging');
export const UPDATE_BACKUP_DIR = path.join(process.cwd(), 'data', 'updates', 'backups');

export type UpdateSettingsRow = Awaited<ReturnType<typeof getUpdateSettings>>;

export async function getUpdateSettings() {
  return prisma.updateSettings.findUnique({ where: { id: UPDATE_SETTINGS_ID } });
}

export async function ensureUpdateSettings() {
  let s = await getUpdateSettings();
  if (!s) s = await prisma.updateSettings.create({ data: { id: UPDATE_SETTINGS_ID } });
  return s;
}

export function encryptOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  return encryptSecret(value);
}

// Browser-safe projection. NEVER returns the encrypted token or its plaintext;
// only a boolean indicating whether a token is stored.
export function maskUpdateSettings(s: NonNullable<Awaited<ReturnType<typeof getUpdateSettings>>>) {
  return {
    id: s.id,
    releaseChannel: s.releaseChannel,
    githubOwner: s.githubOwner,
    githubRepo: s.githubRepo,
    hasToken: !!s.githubTokenEncrypted,
    autoCheck: s.autoCheck,
    hasPublicKey: !!s.publicKeyPem,
    requireSignature: s.requireSignature,
    maintenanceMode: s.maintenanceMode,
    currentVersion: APP_VERSION,
    latestVersion: s.latestVersion,
    latestReleaseAt: s.latestReleaseAt,
    latestCommit: s.latestCommit,
    latestPackageBytes: s.latestPackageBytes,
    latestReleaseNotes: s.latestReleaseNotes,
    latestAssetName: s.latestAssetName,
    latestAssetSha256: s.latestAssetSha256,
    lastCheckAt: s.lastCheckAt,
    lastCheckStatus: s.lastCheckStatus,
    lastCheckError: s.lastCheckError,
    lastSuccessfulUpdateAt: s.lastSuccessfulUpdateAt,
    lastFailedUpdateAt: s.lastFailedUpdateAt,
    productSlug: PRODUCT_SLUG,
  };
}

// Build an authenticated GitHub config (decrypts the token) for server-side use only.
export function toGithubConfig(s: NonNullable<Awaited<ReturnType<typeof getUpdateSettings>>>): GithubConfig | null {
  if (!s.githubOwner || !s.githubRepo) return null;
  let token: string | null = null;
  if (s.githubTokenEncrypted) {
    try { token = decryptSecret(s.githubTokenEncrypted); } catch { token = null; }
  }
  return {
    owner: s.githubOwner,
    repo: s.githubRepo,
    token,
    channel: s.releaseChannel as ReleaseChannel,
  };
}

// --- Section G: pinned trusted signing key + safe-by-default policy ----------
// A deployment can PIN the trusted signing public key (and force signature
// enforcement) at the host/build level via env. A pinned key ALWAYS wins over
// the DB-stored key so an attacker who can only write settings rows cannot
// swap in their own key or turn signature checking off.
export function pinnedPublicKeyPem(): string | null {
  const pem = process.env.UPDATE_SIGNING_PUBLIC_KEY_PEM;
  if (pem && pem.includes('BEGIN') && pem.includes('KEY')) return pem;
  return null;
}

export interface VerificationPolicy {
  publicKeyPem: string | null;
  requireSignature: boolean;
  pinned: boolean;
}

// Resolve the effective verification policy. When a key is pinned via env we
// force requireSignature=true and use the pinned key. Otherwise we honor the
// DB settings but treat signature verification as required by default unless
// the operator has *explicitly* opted out (UPDATE_ALLOW_UNSIGNED=true).
export function resolveVerificationPolicy(s: {
  publicKeyPem?: string | null;
  requireSignature?: boolean;
}): VerificationPolicy {
  const pinned = pinnedPublicKeyPem();
  if (pinned) {
    return { publicKeyPem: pinned, requireSignature: true, pinned: true };
  }
  // Signed-by-default: a signature is required unless the operator explicitly
  // opts out with UPDATE_ALLOW_UNSIGNED=true. The DB flag can only *tighten*,
  // never loosen, this baseline.
  const allowUnsigned = process.env.UPDATE_ALLOW_UNSIGNED === 'true';
  return {
    publicKeyPem: s.publicKeyPem ?? null,
    requireSignature: !allowUnsigned,
    pinned: false,
  };
}
