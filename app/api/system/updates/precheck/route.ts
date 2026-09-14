// Run the update prechecks (ruling #25). ADMIN only. Read-only: gathers the
// settings projection, counts on-disk migrations, and inspects any staged
// package, then returns a pass/warn/fail report plus the ordered install
// pipeline the one-button install will run. Never mutates state or returns secrets.
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { auth } from '@/auth';
import { ensureUpdateSettings } from '@/lib/updates';
import { runPrecheck, type PrecheckContext } from '@/lib/updates/precheck';
import { INSTALL_PIPELINE, DB_MUTATING_FROM } from '@/lib/updates/pipeline';
import { readStagedManifest } from '@/lib/updates/installer';

export const dynamic = 'force-dynamic';

function countMigrations(): number {
  try {
    const dir = path.join(process.cwd(), 'prisma', 'migrations');
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'migration.sql')))
      .length;
  } catch {
    return 0;
  }
}

export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const s = await ensureUpdateSettings();
  const staged = readStagedManifest();

  const ctx: PrecheckContext = {
    githubOwner: s.githubOwner,
    githubRepo: s.githubRepo,
    hasToken: !!s.githubTokenEncrypted,
    releaseChannel: s.releaseChannel,
    latestVersion: s.latestVersion,
    latestCommit: s.latestCommit,
    latestAssetSha256: s.latestAssetSha256,
    requireSignature: s.requireSignature,
    publicKeyPem: s.publicKeyPem,
    migrationCount: countMigrations(),
    stagedVersion: staged?.version ?? null,
  };

  const report = runPrecheck(ctx);
  return NextResponse.json({
    report,
    pipeline: INSTALL_PIPELINE,
    dbMutatingFrom: DB_MUTATING_FROM,
  });
}
