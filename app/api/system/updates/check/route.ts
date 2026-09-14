// Check GitHub for the latest release on the configured channel. ADMIN only.
// Caches the result on UpdateSettings and records an UpdateHistory CHECK entry.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { APP_VERSION } from '@/lib/version';
import { UPDATE_SETTINGS_ID, ensureUpdateSettings, toGithubConfig, maskUpdateSettings } from '@/lib/updates';
import { findLatestUpdate } from '@/lib/updates/github';
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
    const updated = await prisma.updateSettings.update({
      where: { id: UPDATE_SETTINGS_ID },
      data: {
        lastCheckAt: now,
        lastCheckStatus: 'OK',
        lastCheckError: null,
        latestVersion: latest?.version ?? null,
        latestReleaseAt: latest?.publishedAt ? new Date(latest.publishedAt) : null,
        latestCommit: latest?.commit ?? null,
        latestPackageBytes: latest?.packageAsset?.size ?? null,
        latestReleaseNotes: latest?.notes ?? null,
        latestAssetName: latest?.packageAsset?.name ?? null,
      },
    });
    await prisma.updateHistory.create({
      data: {
        action: 'CHECK', source: 'GITHUB', fromVersion: APP_VERSION, toVersion: latest?.version ?? null,
        commit: latest?.commit ?? null, result: 'SUCCESS', installedBy: session.user.email,
        message: updateAvailable ? `Update available: ${latest?.version}` : 'Up to date.', finishedAt: now,
      },
    });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'system.update_check', entityType: 'UpdateSettings', entityId: s.id,
      metadata: { updateAvailable, latest: latest?.version ?? null }, ...requestMeta(req),
    });
    return NextResponse.json({ updateAvailable, latest, settings: maskUpdateSettings(updated) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Update check failed.';
    await prisma.updateSettings.update({
      where: { id: UPDATE_SETTINGS_ID },
      data: { lastCheckAt: now, lastCheckStatus: 'FAILED', lastCheckError: msg },
    });
    await prisma.updateHistory.create({
      data: { action: 'CHECK', source: 'GITHUB', fromVersion: APP_VERSION, result: 'FAILED', installedBy: session.user.email, message: msg, finishedAt: now },
    });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
