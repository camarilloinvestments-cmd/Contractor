// System Update Center status. ADMIN only. Returns the masked settings
// (no secrets), current/latest version info, maintenance flag, and update history.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { isEncryptionAvailable } from '@/lib/crypto';
import { ensureUpdateSettings, maskUpdateSettings } from '@/lib/updates';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const s = await ensureUpdateSettings();
  const history = await prisma.updateHistory.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return NextResponse.json({
    settings: maskUpdateSettings(s),
    history,
    encryptionAvailable: isEncryptionAvailable(),
  });
}
