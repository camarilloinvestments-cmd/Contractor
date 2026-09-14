// Increment 8 (Workstream O) — Geotab fleet connector settings.
// GET returns a browser-safe masked projection (no secrets ever leave the server).
// PUT encrypts the credential at rest and updates connector flags. ADMIN only.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { isEncryptionAvailable } from '@/lib/crypto';
import { FLEET_SETTINGS_ID, getFleetSettings, encryptOrNull, maskFleetSettings } from '@/lib/fleet';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

async function ensureSettings() {
  let s = await getFleetSettings();
  if (!s) s = await prisma.fleetProviderSettings.create({ data: { id: FLEET_SETTINGS_ID } });
  return s;
}

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const s = await ensureSettings();
  return NextResponse.json({ settings: maskFleetSettings(s), encryptionAvailable: isEncryptionAvailable() });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json();
  const data: any = {
    enabled: !!body.enabled,
    syncEnabled: !!body.syncEnabled,
    database: typeof body.database === 'string' ? body.database.trim() || null : null,
    username: typeof body.username === 'string' ? body.username.trim() || null : null,
    serverUrl: typeof body.serverUrl === 'string' ? body.serverUrl.trim() || null : null,
  };
  // Only (re)encrypt the credential when a new value is supplied; support clear.
  if (typeof body.credential === 'string' && body.credential.length > 0) {
    if (!isEncryptionAvailable()) return NextResponse.json({ error: 'Encryption key not configured.' }, { status: 400 });
    data.credentialEncrypted = encryptOrNull(body.credential);
    // A new credential invalidates any cached session id.
    data.sessionIdEncrypted = null;
  } else if (body.clearCredential) {
    data.credentialEncrypted = null;
    data.sessionIdEncrypted = null;
  }
  await ensureSettings();
  const s = await prisma.fleetProviderSettings.update({ where: { id: FLEET_SETTINGS_ID }, data });
  const meta = requestMeta(req);
  await writeAudit({
    actor: { id: session.user.id, email: session.user.email, role: session.user.role },
    action: 'fleet.settings_update',
    entityType: 'FleetProviderSettings',
    entityId: FLEET_SETTINGS_ID,
    ...meta,
  });
  return NextResponse.json({ settings: maskFleetSettings(s) });
}
