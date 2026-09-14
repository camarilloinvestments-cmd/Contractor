// Update precheck engine (ruling #25). Runs the concrete checks that have
// actually broken self-host upgrades before — the package manager + Yarn 4
// lockfile format, Node/Next/Prisma versions, container runtime, disk/RAM/swap
// headroom, required env vars, the migration set, the signature policy, and the
// selected GitHub release/ref — and reports each as pass / warn / fail with an
// operator-readable detail. Everything here is read-only and side-effect free;
// it never mutates settings, the DB, or the filesystem.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { APP_VERSION, APP_BUILD_SHA, getShortSha } from '@/lib/version';
import { resolveVerificationPolicy, pinnedPublicKeyPem } from './index';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface PrecheckItem {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  advanced?: boolean; // technical detail hidden behind the Advanced submenu
}

export interface PrecheckReport {
  ok: boolean; // no failing checks
  hasWarnings: boolean;
  generatedAt: string;
  items: PrecheckItem[];
}

function readPackageJson(): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

function depVersion(pkg: any, name: string): string | null {
  const v = pkg?.dependencies?.[name] || pkg?.devDependencies?.[name] || null;
  return v ? String(v) : null;
}

// Best-effort available-disk probe (bytes) for the app data dir. statfsSync is
// available on modern Node; fall back to null when the platform can't report.
function freeDiskBytes(): number | null {
  try {
    // @ts-ignore - statfsSync exists on Node >= 18.15
    const st = fs.statfsSync(process.cwd());
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    return null;
  }
}

function humanBytes(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export interface PrecheckContext {
  // From UpdateSettings (already resolved by the caller, never secrets).
  githubOwner: string | null;
  githubRepo: string | null;
  hasToken: boolean;
  releaseChannel: string;
  latestVersion: string | null;
  latestCommit: string | null;
  latestAssetSha256: string | null;
  requireSignature: boolean;
  publicKeyPem: string | null;
  // Count of applied/available migrations (caller reads the dir).
  migrationCount: number;
  // Whether a package is currently staged for install.
  stagedVersion: string | null;
}

export function runPrecheck(ctx: PrecheckContext): PrecheckReport {
  const items: PrecheckItem[] = [];
  const pkg = readPackageJson();

  // 1) Package manager pinned to Yarn 4 via corepack.
  {
    const pm = String(pkg.packageManager || '');
    const ok = /^yarn@4\./.test(pm);
    items.push({
      key: 'package_manager',
      label: 'Package manager',
      status: ok ? 'pass' : 'fail',
      detail: ok ? `Pinned to ${pm} (corepack).` : `Expected yarn@4.x in package.json "packageManager"; found ${pm || 'none'}.`,
    });
  }

  // 2) Yarn 4 (Berry) lockfile format.
  {
    let detail = 'yarn.lock not found.';
    let status: CheckStatus = 'fail';
    try {
      const head = fs.readFileSync(path.join(process.cwd(), 'yarn.lock'), 'utf8').slice(0, 400);
      const m = head.match(/__metadata:\s*\n\s*version:\s*(\d+)/);
      const v = m ? parseInt(m[1], 10) : 0;
      if (v >= 6) {
        status = 'pass';
        detail = `Berry lockfile (__metadata version ${v}) — compatible with yarn install --immutable.`;
      } else {
        status = 'fail';
        detail = 'Classic Yarn 1 lockfile detected; a Yarn 4 (Berry) lockfile is required.';
      }
    } catch {
      /* keep default fail */
    }
    items.push({ key: 'yarn_lockfile', label: 'Yarn 4 lockfile', status, detail });
  }

  // 3) Node runtime version.
  {
    const major = parseInt(process.versions.node.split('.')[0], 10);
    const ok = major >= 20;
    items.push({
      key: 'node_version',
      label: 'Node runtime',
      status: ok ? 'pass' : 'fail',
      detail: `${process.version}${ok ? '' : ' (Node 20+ required)'}.`,
    });
  }

  // 4) Next.js + Prisma versions present and pinned.
  {
    const next = depVersion(pkg, 'next');
    items.push({
      key: 'next_version',
      label: 'Next.js version',
      status: next ? 'pass' : 'fail',
      detail: next ? `next ${next}.` : 'next not found in package.json.',
      advanced: true,
    });
    const prismaCli = depVersion(pkg, 'prisma');
    const prismaClient = depVersion(pkg, '@prisma/client');
    const both = prismaCli && prismaClient;
    const aligned = both && prismaCli === prismaClient;
    items.push({
      key: 'prisma_version',
      label: 'Prisma version',
      status: both ? (aligned ? 'pass' : 'warn') : 'fail',
      detail: both
        ? aligned
          ? `prisma & @prisma/client ${prismaCli}.`
          : `prisma ${prismaCli} vs @prisma/client ${prismaClient} — versions should match.`
        : 'prisma / @prisma/client not both present.',
      advanced: true,
    });
  }

  // 5) Container runtime hint (Docker). The app can't shell out reliably, so we
  //    treat presence of /.dockerenv or a cgroup hint as "containerized".
  {
    let containerized = false;
    try {
      containerized = fs.existsSync('/.dockerenv');
      if (!containerized) {
        const cg = fs.readFileSync('/proc/1/cgroup', 'utf8');
        containerized = /docker|containerd|kubepods/i.test(cg);
      }
    } catch {
      /* ignore */
    }
    items.push({
      key: 'container_runtime',
      label: 'Container runtime',
      status: containerized ? 'pass' : 'warn',
      detail: containerized
        ? 'Running in a container — the host installer will build the candidate image and cut over.'
        : 'Not detected as containerized; the host installer must be run on the Docker host.',
      advanced: true,
    });
  }

  // 6) Disk headroom for candidate build + backups.
  {
    const free = freeDiskBytes();
    if (free == null) {
      items.push({ key: 'disk', label: 'Disk space', status: 'warn', detail: 'Unable to determine free disk space.', advanced: true });
    } else {
      const min = 3 * 1024 * 1024 * 1024; // 3 GB
      const ok = free >= min;
      items.push({
        key: 'disk',
        label: 'Disk space',
        status: ok ? 'pass' : 'fail',
        detail: `${humanBytes(free)} free${ok ? '' : ' — at least 3 GB recommended for the candidate build + backup'}.`,
        advanced: true,
      });
    }
  }

  // 7) RAM + swap headroom (candidate build needs a large Node heap).
  {
    const total = os.totalmem();
    const freeMem = os.freemem();
    const min = 2 * 1024 * 1024 * 1024; // 2 GB free suggested
    const ok = freeMem >= min;
    items.push({
      key: 'memory',
      label: 'Memory',
      status: ok ? 'pass' : 'warn',
      detail: `${humanBytes(freeMem)} free of ${humanBytes(total)} total${ok ? '' : ' — the webpack build uses a 12 GB max heap; ensure swap is configured'}.`,
      advanced: true,
    });
  }

  // 8) Required environment variables (never print their values).
  {
    const required = ['DATABASE_URL', 'NEXTAUTH_SECRET', 'APP_ENCRYPTION_KEY'];
    const missing = required.filter((k) => !process.env[k]);
    items.push({
      key: 'env_vars',
      label: 'Environment variables',
      status: missing.length === 0 ? 'pass' : 'fail',
      detail: missing.length === 0 ? 'All required variables are set.' : `Missing: ${missing.join(', ')}.`,
    });
  }

  // 9) Migration set present.
  {
    const ok = ctx.migrationCount > 0;
    items.push({
      key: 'migrations',
      label: 'Migration set',
      status: ok ? 'pass' : 'warn',
      detail: ok ? `${ctx.migrationCount} Prisma migration(s) on disk.` : 'No migrations found on disk.',
    });
  }

  // 10) Signature policy — pinned key + enforcement (ruling #25: pinned, not
  //     operator-pasted; signed required by default).
  {
    const policy = resolveVerificationPolicy({ publicKeyPem: ctx.publicKeyPem, requireSignature: ctx.requireSignature });
    const pinned = !!pinnedPublicKeyPem();
    const haveKey = !!policy.publicKeyPem;
    let status: CheckStatus = 'pass';
    let detail: string;
    if (!policy.requireSignature) {
      status = 'warn';
      detail = 'Signature enforcement is OFF (UPDATE_ALLOW_UNSIGNED=true). Signed releases are strongly recommended.';
    } else if (!haveKey) {
      status = 'fail';
      detail = 'Signature is required but no trusted public key is available. Pin UPDATE_SIGNING_PUBLIC_KEY_PEM.';
    } else {
      detail = pinned
        ? 'Trusted signing key is pinned at the host level and signature enforcement is required.'
        : 'Signature enforcement is required using the configured public key.';
    }
    items.push({ key: 'signature_policy', label: 'Release signature', status, detail });
  }

  // 11) GitHub release / ref selected for the target.
  {
    const configured = !!(ctx.githubOwner && ctx.githubRepo);
    if (!configured) {
      items.push({ key: 'release_ref', label: 'Release source', status: 'fail', detail: 'GitHub owner/repository is not configured.' });
    } else if (!ctx.latestVersion) {
      items.push({ key: 'release_ref', label: 'Release source', status: 'warn', detail: `Connected to ${ctx.githubOwner}/${ctx.githubRepo}; run Check for Updates to resolve the latest ${ctx.releaseChannel} release.` });
    } else {
      items.push({
        key: 'release_ref',
        label: 'Release source',
        status: 'pass',
        detail: `${ctx.githubOwner}/${ctx.githubRepo} → ${ctx.latestVersion}${ctx.latestCommit ? ` @ ${getShortSha(ctx.latestCommit)}` : ''} (${ctx.releaseChannel}).`,
      });
    }
  }

  // 12) Candidate-build readiness (self-host build target + heap flag present).
  {
    const hasTarget = !!pkg?.scripts?.['build:selfhost'];
    items.push({
      key: 'candidate_build',
      label: 'Candidate build',
      status: hasTarget ? 'pass' : 'fail',
      detail: hasTarget
        ? `Will build contractor-app:candidate-${getShortSha(ctx.latestCommit || APP_BUILD_SHA)} via build:selfhost (webpack, 12 GB heap).`
        : 'Missing build:selfhost script required for the candidate image build.',
      advanced: true,
    });
  }

  // 13) Running build identity (informational).
  items.push({
    key: 'running_build',
    label: 'Running build',
    status: 'pass',
    detail: `v${APP_VERSION} @ ${getShortSha()}${ctx.stagedVersion ? ` — staged: v${ctx.stagedVersion}` : ''}.`,
    advanced: true,
  });

  const ok = items.every((i) => i.status !== 'fail');
  const hasWarnings = items.some((i) => i.status === 'warn');
  return { ok, hasWarnings, generatedAt: new Date().toISOString(), items };
}
