import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { countRemainingRecoveryCodes, isMfaRequiredForRole } from '@/lib/mfa';

export const dynamic = 'force-dynamic';

// Current user's MFA status for the security settings screen.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, mfaEnabled: true, mfaEnrolledAt: true, mfaLastVerifiedAt: true },
  });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [remaining, required] = await Promise.all([
    user.mfaEnabled ? countRemainingRecoveryCodes(session.user.id) : Promise.resolve(0),
    isMfaRequiredForRole(user.role),
  ]);
  return NextResponse.json({
    mfaEnabled: user.mfaEnabled,
    required,
    enrolledAt: user.mfaEnrolledAt,
    lastVerifiedAt: user.mfaLastVerifiedAt,
    recoveryCodesRemaining: remaining,
  });
}
