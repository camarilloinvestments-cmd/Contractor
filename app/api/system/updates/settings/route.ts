// Update-center settings. ADMIN only. PUT stores the release channel, GitHub
// source (owner/repo), an encrypted PAT for private-repo access, the signature
// public key, and the requireSignature / autoCheck toggles.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { isEncryptionAvailable } from '@/lib/crypto';
import { UPDATE_SETTINGS_ID, ensureUpdateSettings, encryptOrNull, maskUpdateSettings } from '@/lib/updates';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const CHANNELS = ['STABLE', 'RC', 'BETA'];

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json();
  const data: any = {
    releaseChannel: CHANNELS.includes(body.releaseChannel) ? body.releaseChannel : 'RC',
    githubOwner: typeof body.githubOwner === 'string' ? body.githubOwner.trim() || null : null,
    githubRepo: typeof body.githubRepo === 'string' ? body.githubRepo.trim() || null : null,
    autoCheck: !!body.autoCheck,
    requireSignature: !!body.requireSignature,
    publicKeyPem: typeof body.publicKeyPem === 'string' ? body.publicKeyPem.trim() || null : undefined,
  };
  if (data.publicKeyPem === undefined) delete data.publicKeyPem;

  // Only (re)encrypt the token when a new value is supplied; support explicit clear.
  if (typeof body.githubToken === 'string' && body.githubToken.length > 0) {
    if (!isEncryptionAvailable()) return NextResponse.json({ error: 'Encryption key not configured.' }, { status: 400 });
    data.githubTokenEncrypted = encryptOrNull(body.githubToken.trim());
  } else if (body.clearToken) {
    data.githubTokenEncrypted = null;
  }

  await ensureUpdateSettings();
  const s = await prisma.updateSettings.update({ where: { id: UPDATE_SETTINGS_ID }, data });
  await writeAudit({
    actor: { id: session.user.id, email: session.user.email, role: session.user.role },
    action: 'system.update_settings',
    entityType: 'UpdateSettings',
    entityId: UPDATE_SETTINGS_ID,
    ...requestMeta(req),
  });
  return NextResponse.json({ settings: maskUpdateSettings(s) });
}
