// Manual maintenance-mode toggle. ADMIN only. Reversible at any time.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { UPDATE_SETTINGS_ID, ensureUpdateSettings, maskUpdateSettings } from '@/lib/updates';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await ensureUpdateSettings();
  const body = await req.json().catch(() => ({}));
  const enabled = !!body.enabled;
  const s = await prisma.updateSettings.update({ where: { id: UPDATE_SETTINGS_ID }, data: { maintenanceMode: enabled } });
  await writeAudit({
    actor: { id: session.user.id, email: session.user.email, role: session.user.role },
    action: 'system.update_maintenance', entityType: 'UpdateSettings', entityId: UPDATE_SETTINGS_ID,
    metadata: { enabled }, ...requestMeta(req),
  });
  return NextResponse.json({ settings: maskUpdateSettings(s) });
}
