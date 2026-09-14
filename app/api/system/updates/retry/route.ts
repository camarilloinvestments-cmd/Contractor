// Retry the last failed update. ADMIN only.
// Re-runs the GitHub check + download + verify path for the configured channel.
// If a newer verified package results, it ends up staged and ready to install
// exactly as a normal download would.
import { NextResponse } from 'next/server';
import fs from 'fs';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { APP_VERSION } from '@/lib/version';
import { UPDATE_SETTINGS_ID, ensureUpdateSettings, toGithubConfig, resolveVerificationPolicy } from '@/lib/updates';
import { findLatestUpdate, downloadAsset } from '@/lib/updates/github';
import { parseManifest } from '@/lib/updates/manifest';
import { ensureDirs, stagedPackagePath, stagedManifestPath, verifyStaged } from '@/lib/updates/installer';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const s = await ensureUpdateSettings();
  const cfg = toGithubConfig(s);
  if (!cfg) return NextResponse.json({ error: 'Configure GitHub owner and repository first.' }, { status: 400 });

  const now = new Date();
  try {
    const { latest, updateAvailable } = await findLatestUpdate(cfg, APP_VERSION);
    if (!latest || !updateAvailable) return NextResponse.json({ error: 'No newer release to retry.' }, { status: 400 });
    if (!latest.packageAsset || !latest.manifestAsset) {
      return NextResponse.json({ error: 'Release is missing the package (.tar.gz) or manifest.json asset.' }, { status: 400 });
    }

    ensureDirs();
    const manifestBuf = await downloadAsset(cfg, latest.manifestAsset);
    const manifest = parseManifest(manifestBuf.toString('utf8'));
    fs.writeFileSync(stagedManifestPath(), manifestBuf);
    const pkgBuf = await downloadAsset(cfg, latest.packageAsset);
    fs.writeFileSync(stagedPackagePath(manifest.filename), pkgBuf);

    const policy = resolveVerificationPolicy(s);
    const verification = verifyStaged(manifest, { publicKeyPem: policy.publicKeyPem, requireSignature: policy.requireSignature });
    if (!verification.ok) {
      try { fs.rmSync(stagedPackagePath(manifest.filename)); } catch {}
      try { fs.rmSync(stagedManifestPath()); } catch {}
      await prisma.updateHistory.create({
        data: { action: 'RETRY', source: 'GITHUB', fromVersion: APP_VERSION, toVersion: manifest.version, commit: latest.commit,
          result: 'FAILED', installedBy: session.user.email, message: 'Verification failed', logs: verification.errors.join('\n'), finishedAt: now },
      });
      return NextResponse.json({ error: 'Package verification failed; download discarded.', verification }, { status: 400 });
    }

    await prisma.updateSettings.update({ where: { id: UPDATE_SETTINGS_ID }, data: { latestAssetSha256: manifest.sha256, lastFailedUpdateAt: s.lastFailedUpdateAt } });
    await prisma.updateHistory.create({
      data: { action: 'RETRY', source: 'GITHUB', fromVersion: APP_VERSION, toVersion: manifest.version, commit: latest.commit,
        result: 'SUCCESS', installedBy: session.user.email, message: `Retried: downloaded & verified ${manifest.filename}`,
        logs: `checksum=OK signature=${verification.signatureOk === null ? 'n/a' : verification.signatureOk}`, finishedAt: now },
    });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'system.update_retry', entityType: 'UpdateSettings', entityId: s.id,
      metadata: { version: manifest.version }, ...requestMeta(req),
    });
    return NextResponse.json({ ok: true, manifest, verification });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Retry failed.';
    await prisma.updateHistory.create({
      data: { action: 'RETRY', source: 'GITHUB', fromVersion: APP_VERSION, result: 'FAILED', installedBy: session.user.email, message: msg, finishedAt: now },
    });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
