// Roll back to the previously installed version. ADMIN only.
// Like install, the actual host-level restore (previous release image + DB
// backup) is performed by scripts/install-update.sh --rollback. This endpoint
// records the intent/history and returns the host command + guidance.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { APP_VERSION } from '@/lib/version';
import { UPDATE_SETTINGS_ID, ensureUpdateSettings } from '@/lib/updates';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await ensureUpdateSettings();
  const now = new Date();

  // The most recent successful/attempted install tells us the version we came from.
  const lastInstall = await prisma.updateHistory.findFirst({
    where: { action: 'INSTALL' },
    orderBy: { createdAt: 'desc' },
  });
  const rollbackTarget = lastInstall?.fromVersion ?? null;

  const history = await prisma.updateHistory.create({
    data: {
      action: 'ROLLBACK', source: lastInstall?.source ?? 'GITHUB', fromVersion: APP_VERSION, toVersion: rollbackTarget,
      commit: null, result: 'IN_PROGRESS', installedBy: session.user.email,
      message: rollbackTarget ? `Rollback requested to ${rollbackTarget}.` : 'Rollback requested (no prior version recorded).',
      startedAt: now,
    },
  });

  await prisma.updateSettings.update({ where: { id: UPDATE_SETTINGS_ID }, data: { maintenanceMode: true } });

  await writeAudit({
    actor: { id: session.user.id, email: session.user.email, role: session.user.role },
    action: 'system.update_rollback', entityType: 'UpdateHistory', entityId: history.id,
    metadata: { rollbackTarget }, ...requestMeta(req),
  });

  return NextResponse.json({
    ok: true,
    historyId: history.id,
    rollbackTarget,
    command: 'scripts/install-update.sh --rollback',
    note: 'Rollback recorded and maintenance mode enabled. Run the host installer with --rollback to restore the previous release image and (if needed) the pre-update database backup. It clears maintenance mode when the restored app passes health checks.',
  });
}
