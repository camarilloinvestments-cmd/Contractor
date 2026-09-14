// Workstream M — payment settings (GET masked / PUT encrypt). ADMIN only.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { encryptSecret, isEncryptionAvailable } from '@/lib/crypto';
import { maskPaymentSettings } from '@/lib/payments';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

async function getSettings() {
  let s = await prisma.paymentSettings.findUnique({ where: { id: 'default' } });
  if (!s) s = await prisma.paymentSettings.create({ data: { id: 'default' } });
  return s;
}

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const s = await getSettings();
  return NextResponse.json({ settings: maskPaymentSettings(s), encryptionAvailable: isEncryptionAvailable() });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json();
  // Production is not authorized in this release.
  const environment = body.environment === 'PRODUCTION' ? 'SANDBOX' : (body.environment || 'SANDBOX');
  const data: any = {
    enabled: !!body.enabled,
    environment,
    merchantId: body.merchantId ?? null,
    terminalId: body.terminalId ?? null,
    cardEnabled: body.cardEnabled ?? true,
    achEnabled: body.achEnabled ?? false,
    tokenizationEnabled: body.tokenizationEnabled ?? false,
  };
  // Only (re)encrypt secrets when a new value is supplied; support explicit clear.
  if (typeof body.apiUsername === 'string' && body.apiUsername.length > 0) {
    if (!isEncryptionAvailable()) return NextResponse.json({ error: 'Encryption key not configured.' }, { status: 400 });
    data.apiUsernameEncrypted = encryptSecret(body.apiUsername);
  } else if (body.clearApiUsername) {
    data.apiUsernameEncrypted = null;
  }
  if (typeof body.apiPassword === 'string' && body.apiPassword.length > 0) {
    if (!isEncryptionAvailable()) return NextResponse.json({ error: 'Encryption key not configured.' }, { status: 400 });
    data.apiPasswordEncrypted = encryptSecret(body.apiPassword);
  } else if (body.clearApiPassword) {
    data.apiPasswordEncrypted = null;
  }
  await getSettings();
  const s = await prisma.paymentSettings.update({ where: { id: 'default' }, data });
  const meta = requestMeta(req);
  await writeAudit({ actor: { id: session.user.id, email: session.user.email, role: session.user.role }, action: 'payment_settings.update', entityType: 'PaymentSettings', entityId: 'default', ...meta });
  return NextResponse.json({ settings: maskPaymentSettings(s) });
}
