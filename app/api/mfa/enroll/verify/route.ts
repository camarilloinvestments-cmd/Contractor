import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { verifyTotp, decryptTotpSecret, replaceRecoveryCodes } from '@/lib/mfa';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// Complete MFA enrollment: verify a TOTP code against the pending secret, enable
// MFA, and issue one-time recovery codes (returned ONCE, stored only as hashes).
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
  if (user.mfaEnabled) {
    return NextResponse.json({ error: 'MFA is already enabled.' }, { status: 409 });
  }
  if (!user.mfaSecret) {
    return NextResponse.json({ error: 'Start enrollment first.' }, { status: 400 });
  }

  let ok = false;
  try {
    ok = verifyTotp(code, decryptTotpSecret(user.mfaSecret));
  } catch {
    ok = false;
  }
  if (!ok) {
    return NextResponse.json({ error: 'Invalid code. Try again.' }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { mfaEnabled: true, mfaEnrolledAt: new Date(), mfaLastVerifiedAt: new Date() },
  });
  const recoveryCodes = await replaceRecoveryCodes(user.id);

  await writeAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: 'mfa.enrolled',
    entityType: 'User',
    entityId: user.id,
    metadata: { email: user.email },
    ...requestMeta(req),
  });

  return NextResponse.json({ success: true, recoveryCodes });
}
