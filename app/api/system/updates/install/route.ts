// Install the staged, verified update. ADMIN only.
// SAFETY: this re-verifies the staged package (checksum + signature) and refuses
// to proceed on any failure — the updater NEVER installs an unverified package.
// A containerized Node app cannot safely swap its own image and restart itself,
// so this endpoint performs the control-plane steps (verify → preflight → record
// history → write install plan → enable maintenance mode) and hands the actual
// host-level stage/migrate/restart to scripts/install-update.sh, which consumes
// data/updates/staging/install-plan.json. Auto-rollback is handled host-side.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { APP_VERSION } from '@/lib/version';
import { UPDATE_SETTINGS_ID, ensureUpdateSettings, resolveVerificationPolicy } from '@/lib/updates';
import { readStagedManifest, verifyStaged, preflight, writeInstallPlan, installPlanPath, stagedPackagePath } from '@/lib/updates/installer';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const s = await ensureUpdateSettings();
  const now = new Date();

  const manifest = readStagedManifest();
  if (!manifest) {
    return NextResponse.json({ error: 'No staged update found. Download or upload a package first.' }, { status: 400 });
  }

  // Re-verify at install time — never trust that the staged package is still good.
  // Use the pinned/safe-by-default policy: a build-pinned key (and forced
  // signature enforcement) overrides whatever is stored in settings.
  const policy = resolveVerificationPolicy(s);
  const verification = verifyStaged(manifest, { publicKeyPem: policy.publicKeyPem, requireSignature: policy.requireSignature });
  if (!verification.ok) {
    await prisma.updateHistory.create({
      data: {
        action: 'INSTALL', source: 'GITHUB', fromVersion: APP_VERSION, toVersion: manifest.version, commit: manifest.commit ?? null,
        result: 'FAILED', installedBy: session.user.email, message: 'Refused: package failed verification.',
        logs: verification.errors.join('\n'), finishedAt: now,
      },
    });
    return NextResponse.json({ error: 'Package verification failed; install refused.', verification }, { status: 400 });
  }

  // Preflight gate.
  const pf = await preflight(manifest);
  if (!pf.ok) {
    await prisma.updateHistory.create({
      data: {
        action: 'INSTALL', source: 'GITHUB', fromVersion: APP_VERSION, toVersion: manifest.version, commit: manifest.commit ?? null,
        result: 'FAILED', installedBy: session.user.email, message: 'Preflight checks failed.',
        logs: pf.checks.map((c) => `${c.ok ? 'OK' : 'FAIL'} ${c.name}: ${c.detail}`).join('\n'), finishedAt: now,
      },
    });
    return NextResponse.json({ error: 'Preflight checks failed; install refused.', preflight: pf }, { status: 400 });
  }

  // Record the in-progress install and write the plan the host installer consumes.
  const history = await prisma.updateHistory.create({
    data: {
      action: 'INSTALL', source: 'GITHUB', fromVersion: APP_VERSION, toVersion: manifest.version, commit: manifest.commit ?? null,
      result: 'IN_PROGRESS', installedBy: session.user.email, message: 'Staged & verified; awaiting host installer.', startedAt: now,
    },
  });

  writeInstallPlan({
    historyId: history.id,
    fromVersion: APP_VERSION,
    toVersion: manifest.version,
    commit: manifest.commit ?? null,
    packageFile: stagedPackagePath(manifest.filename),
    sha256: manifest.sha256,
    requestedBy: session.user.email ?? null,
    requestedAt: now.toISOString(),
  });

  // Enable maintenance mode so no writes happen while the host swaps versions.
  await prisma.updateSettings.update({ where: { id: UPDATE_SETTINGS_ID }, data: { maintenanceMode: true } });

  await writeAudit({
    actor: { id: session.user.id, email: session.user.email, role: session.user.role },
    action: 'system.update_install', entityType: 'UpdateHistory', entityId: history.id,
    metadata: { version: manifest.version }, ...requestMeta(req),
  });

  return NextResponse.json({
    ok: true,
    historyId: history.id,
    verification,
    preflight: pf,
    planPath: installPlanPath(),
    note: 'Package verified and staged, maintenance mode enabled, install plan written. Run the host installer (scripts/install-update.sh) to apply migrations, swap the release, restart, and run health checks. It will auto-roll back and clear maintenance mode on failure.',
  });
}
