// Increment 8 (Workstream O) — Geotab connection test. ADMIN only.
// Verifies credentials against the provider without persisting telemetry.
// The decrypted credential never leaves the server and is never logged.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { FLEET_SETTINGS_ID, getFleetSettings, getFleetProvider, toProviderConfig, encryptOrNull, maskFleetSettings } from '@/lib/fleet';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const settings = await getFleetSettings();
  if (!settings) {
    return NextResponse.json({ error: 'Configure the Geotab connector before testing.' }, { status: 400 });
  }
  const provider = getFleetProvider(settings);
  const cfg = toProviderConfig(settings);
  const now = new Date();
  let result;
  try {
    result = await provider.testConnection(cfg);
  } catch (e: any) {
    result = { ok: false, message: e?.message || 'Connection failed.' };
  }
  const data: any = result.ok
    ? { lastConnectionStatus: 'OK', lastSuccessAt: now, lastSyncError: null }
    : { lastConnectionStatus: 'FAILED', lastFailureAt: now, lastSyncError: (result.message || 'Connection failed.').slice(0, 500) };
  // Cache session id when the provider returned one (encrypted at rest).
  if (result.ok && result.sessionId) data.sessionIdEncrypted = encryptOrNull(result.sessionId);
  const s = await prisma.fleetProviderSettings.update({ where: { id: FLEET_SETTINGS_ID }, data });
  const meta = requestMeta(req);
  await writeAudit({
    actor: { id: session.user.id, email: session.user.email, role: session.user.role },
    action: 'fleet.test_connection',
    entityType: 'FleetProviderSettings',
    entityId: FLEET_SETTINGS_ID,
    metadata: { ok: result.ok },
    ...meta,
  });
  return NextResponse.json({ ok: result.ok, message: result.message ?? null, settings: maskFleetSettings(s) });
}
