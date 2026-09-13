import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import {
  generateTotpSecret,
  buildOtpAuthUri,
  otpAuthQrDataUrl,
  encryptTotpSecret,
} from '@/lib/mfa';
import { isEncryptionAvailable } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

// Begin (or restart) MFA enrollment: issues a fresh pending TOTP secret and
// returns the QR + manual key for the authenticated user. The secret is stored
// encrypted with mfaEnabled=false until verified.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isEncryptionAvailable()) {
    return NextResponse.json(
      { error: 'Encryption is not configured on the server; MFA cannot be set up.' },
      { status: 503 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, mfaEnabled: true },
  });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.mfaEnabled) {
    return NextResponse.json(
      { error: 'MFA is already enabled. Reset it before re-enrolling.' },
      { status: 409 },
    );
  }

  const profile = await prisma.companyProfile.findFirst({ select: { companyName: true } });
  const issuer = profile?.companyName || 'OS1 Fiber Track Pro';

  const secret = generateTotpSecret();
  const uri = buildOtpAuthUri(secret, user.email, issuer);
  const qr = await otpAuthQrDataUrl(uri);

  await prisma.user.update({
    where: { id: user.id },
    data: { mfaSecret: encryptTotpSecret(secret), mfaEnabled: false },
  });

  // Return the manual-entry key and QR. The secret itself is only shown here for
  // manual authenticator setup; it is never logged or audited.
  return NextResponse.json({ qr, manualKey: secret, issuer, account: user.email });
}
