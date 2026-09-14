// Safe-install orchestration helpers (Workstream U). The in-app control plane
// downloads to an isolated staging dir, verifies checksum + signature, runs
// preflight, and records history. The actual host-level swap/migrate/restart is
// performed by scripts/install-update.sh which reads the install plan written
// here. This keeps a containerized app from unsafely replacing itself while
// still enforcing that NO unverified package is ever installed.
import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { APP_VERSION } from '@/lib/version';
import { compareVersions } from './semver';
import { parseManifest, verifyPackage, type ReleaseManifest, type VerificationResult } from './manifest';
import { UPDATE_STAGING_DIR } from './index';

export function ensureDirs() {
  fs.mkdirSync(UPDATE_STAGING_DIR, { recursive: true });
}

export function stagedPackagePath(filename: string) {
  // Never allow path traversal from an untrusted filename.
  return path.join(UPDATE_STAGING_DIR, path.basename(filename));
}
export function stagedManifestPath() {
  return path.join(UPDATE_STAGING_DIR, 'manifest.json');
}
export function installPlanPath() {
  return path.join(UPDATE_STAGING_DIR, 'install-plan.json');
}

export function readStagedManifest(): ReleaseManifest | null {
  const p = stagedManifestPath();
  if (!fs.existsSync(p)) return null;
  try { return parseManifest(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

export function verifyStaged(
  manifest: ReleaseManifest,
  opts: { publicKeyPem?: string | null; requireSignature?: boolean }
): VerificationResult {
  const pkgPath = stagedPackagePath(manifest.filename);
  if (!fs.existsSync(pkgPath)) {
    return { ok: false, checksumOk: false, signatureOk: null, errors: ['Staged package file is missing.'] };
  }
  const buf = fs.readFileSync(pkgPath);
  return verifyPackage(buf, manifest, opts);
}

export interface PreflightResult {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
}

// Preflight gate: DB reachable, package newer than current, and current version
// meets the package's minimum-supported-version requirement.
export async function preflight(manifest: ReleaseManifest): Promise<PreflightResult> {
  const checks: PreflightResult['checks'] = [];

  let dbOk = true;
  try { await prisma.$queryRaw`SELECT 1`; } catch { dbOk = false; }
  checks.push({ name: 'Database connectivity', ok: dbOk, detail: dbOk ? 'Reachable.' : 'Database unreachable.' });

  const newer = compareVersions(manifest.version, APP_VERSION) > 0;
  checks.push({ name: 'Target newer than current', ok: newer, detail: `${APP_VERSION} \u2192 ${manifest.version}` });

  let minOk = true;
  let minDetail = 'No minimum specified.';
  if (manifest.minimumSupportedVersion) {
    minOk = compareVersions(APP_VERSION, manifest.minimumSupportedVersion) >= 0;
    minDetail = `requires \u2265 ${manifest.minimumSupportedVersion}, current ${APP_VERSION}`;
  }
  checks.push({ name: 'Minimum supported version', ok: minOk, detail: minDetail });

  return { ok: checks.every((c) => c.ok), checks };
}

// Persist an install plan the host installer script consumes. Includes only
// non-secret info (paths, versions, checksum) \u2014 never any credential.
export function writeInstallPlan(plan: {
  historyId: string;
  fromVersion: string;
  toVersion: string;
  commit: string | null;
  packageFile: string;
  sha256: string;
  requestedBy: string | null;
  requestedAt: string;
}) {
  ensureDirs();
  fs.writeFileSync(installPlanPath(), JSON.stringify(plan, null, 2));
}
