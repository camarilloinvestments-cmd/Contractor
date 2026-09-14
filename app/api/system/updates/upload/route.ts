// Manual package upload (Workstream U). ADMIN only.
// A manually uploaded package goes through the EXACT SAME validation path as a
// GitHub download: parse manifest → stage → verify checksum (always) + signature
// (when a key is configured). An unverified package is deleted and never retained.
import { NextResponse } from 'next/server';
import fs from 'fs';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { APP_VERSION } from '@/lib/version';
import { ensureUpdateSettings, resolveVerificationPolicy } from '@/lib/updates';
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
  const now = new Date();

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 }); }

  const pkg = form.get('package');
  const manifestEntry = form.get('manifest');
  if (!(pkg instanceof File)) return NextResponse.json({ error: 'Missing package file (field "package").' }, { status: 400 });
  if (!(manifestEntry instanceof File) && typeof manifestEntry !== 'string') {
    return NextResponse.json({ error: 'Missing manifest (field "manifest": file or JSON string).' }, { status: 400 });
  }

  try {
    const manifestText = manifestEntry instanceof File ? await manifestEntry.text() : manifestEntry;
    const manifest = parseManifest(manifestText);

    ensureDirs();
    fs.writeFileSync(stagedManifestPath(), manifestText);
    const pkgBuf = Buffer.from(await pkg.arrayBuffer());
    fs.writeFileSync(stagedPackagePath(manifest.filename), pkgBuf);

    const policy = resolveVerificationPolicy(s);
    const verification = verifyStaged(manifest, { publicKeyPem: policy.publicKeyPem, requireSignature: policy.requireSignature });
    if (!verification.ok) {
      try { fs.rmSync(stagedPackagePath(manifest.filename)); } catch {}
      try { fs.rmSync(stagedManifestPath()); } catch {}
      await prisma.updateHistory.create({
        data: { action: 'UPLOAD', source: 'MANUAL', fromVersion: APP_VERSION, toVersion: manifest.version, commit: manifest.commit ?? null,
          result: 'FAILED', installedBy: session.user.email, message: 'Verification failed', logs: verification.errors.join('\n'), finishedAt: now },
      });
      return NextResponse.json({ error: 'Package verification failed; upload discarded.', verification }, { status: 400 });
    }

    await prisma.updateHistory.create({
      data: { action: 'UPLOAD', source: 'MANUAL', fromVersion: APP_VERSION, toVersion: manifest.version, commit: manifest.commit ?? null,
        result: 'SUCCESS', installedBy: session.user.email, message: `Uploaded & verified ${manifest.filename}`,
        logs: `checksum=OK signature=${verification.signatureOk === null ? 'n/a' : verification.signatureOk}`, finishedAt: now },
    });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'system.update_upload', entityType: 'UpdateSettings', entityId: s.id,
      metadata: { version: manifest.version, filename: manifest.filename }, ...requestMeta(req),
    });
    return NextResponse.json({ ok: true, manifest, verification });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Upload failed.';
    await prisma.updateHistory.create({
      data: { action: 'UPLOAD', source: 'MANUAL', fromVersion: APP_VERSION, result: 'FAILED', installedBy: session.user.email, message: msg, finishedAt: now },
    });
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
