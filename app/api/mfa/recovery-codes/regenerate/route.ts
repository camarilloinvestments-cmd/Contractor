import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { verifyTotp, decryptTotpSecret, replaceRecoveryCodes } from '@/lib/mfa';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// Self-service regeneration of recovery codes. Requires a valid current TOTP
// code to prove possession of the authenticator. Old codes are invalidated.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const code = typeof body?.code === 'string' ? body.code : '';

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, role: true, mfaSecret: true, mfaEnabled: true },
  });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.mfaEnabled || !user.mfaSecret) {
    return NextResponse.json({ error: 'MFA is not enabled.' }, { status: 400 });
  }

  let ok = false;
  try {
    ok = verifyTotp(code, decryptTotpSecret(user.mfaSecret));
  } catch {
    ok = false;
  }
  if (!ok) return NextResponse.json({ error: 'Invalid authenticator code.' }, { status: 400 });

  const recoveryCodes = await replaceRecoveryCodes(user.id);
  await writeAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: 'mfa.recovery_regenerated',
    entityType: 'User',
    entityId: user.id,
    metadata: { email: user.email, count: recoveryCodes.length },
    ...requestMeta(req),
  });

  return NextResponse.json({ success: true, recoveryCodes });
}
