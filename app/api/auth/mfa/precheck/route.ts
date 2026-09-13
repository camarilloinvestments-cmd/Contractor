import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { isMfaRequiredForRole } from '@/lib/mfa';

export const dynamic = 'force-dynamic';

// Pre-authentication probe: verifies email+password WITHOUT creating a session,
// so the login UI knows whether to prompt for an MFA code before calling signIn.
// Returns generic { ok:false } on any credential failure (no user enumeration).
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const email = typeof body?.email === 'string' ? body.email : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || !password) return NextResponse.json({ ok: false });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== 'ACTIVE') return NextResponse.json({ ok: false });
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return NextResponse.json({ ok: false });

  const required = await isMfaRequiredForRole(user.role);
  return NextResponse.json({
    ok: true,
    mfaEnabled: user.mfaEnabled,
    // Only prompt for a code when a secret is already enrolled. If MFA is
    // required but not enrolled, login proceeds and the app forces enrollment.
    mfaChallenge: user.mfaEnabled,
    mfaRequired: required,
  });
}
