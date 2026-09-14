// Increment 10 — Workstream P: mobile login (MFA-compatible), device register.
// Server is authoritative. Password + optional TOTP are verified here and a
// device-bound session token is issued. The token is returned exactly once.
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { verifyTotp, decryptTotpSecret } from '@/lib/mfa';
import { registerDeviceAndIssueSession, clientIp } from '@/lib/mobile/auth';
import { writeAudit, requestMeta } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const mfaCode = typeof body?.mfaCode === 'string' ? body.mfaCode.trim() : '';
  const deviceUuid = typeof body?.deviceUuid === 'string' ? body.deviceUuid.trim() : '';

  if (!email || !password) return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
  if (!deviceUuid) return NextResponse.json({ error: 'Missing deviceUuid' }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email }, include: { worker: true } });
  if (!user || user.status !== 'ACTIVE') return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });

  // MFA-compatible: if enrolled, a valid TOTP (or the app can add recovery) is required.
  let mfaVerified = false;
  if (user.mfaEnabled && user.mfaSecret) {
    if (!mfaCode) return NextResponse.json({ error: 'MFA code required', mfaRequired: true }, { status: 401 });
    const okCode = verifyTotp(mfaCode, decryptTotpSecret(user.mfaSecret));
    if (!okCode) return NextResponse.json({ error: 'Invalid MFA code', mfaRequired: true }, { status: 401 });
    mfaVerified = true;
  }

  const ip = clientIp(req);
  const issued = await registerDeviceAndIssueSession({
    deviceUuid,
    userId: user.id,
    workerId: user.workerId ?? user.worker?.id ?? null,
    platform: body?.platform === 'IOS' || body?.platform === 'WEB' ? body.platform : 'ANDROID',
    deviceName: body?.deviceName ?? null,
    deviceModel: body?.deviceModel ?? null,
    osVersion: body?.osVersion ?? null,
    appVersion: body?.appVersion ?? null,
    pushToken: body?.pushToken ?? null,
    mfaVerified,
    ip,
  });

  await writeAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: 'mobile.login',
    entityType: 'MobileDevice',
    entityId: issued.deviceId,
    metadata: { deviceUuid, mfaVerified },
    ...requestMeta(req),
  });

  return NextResponse.json({
    token: issued.token,
    expiresAt: issued.expiresAt,
    deviceId: issued.deviceId,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      workerId: user.workerId ?? user.worker?.id ?? null,
    },
  });
}
