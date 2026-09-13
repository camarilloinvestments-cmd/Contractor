export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';
import type { UserRole } from '@prisma/client';

const ROLES: UserRole[] = ['ADMIN', 'PROJECT_MANAGER', 'FIELD_WORKER'];

// GET current role-based MFA policy (admin only).
export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rows = await prisma.mfaPolicy.findMany();
  const map = new Map(rows.map((r) => [r.role, r.required]));
  const policy = ROLES.map((role) => ({
    role,
    // ADMIN defaults to required if no row exists yet.
    required: map.has(role) ? Boolean(map.get(role)) : role === 'ADMIN',
  }));
  return NextResponse.json({ policy });
}

// PUT update role-based MFA policy (admin only). ADMIN is always required and
// cannot be disabled (spec: admins may not permanently bypass required MFA).
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const incoming: Array<{ role: UserRole; required: boolean }> = Array.isArray(body?.policy)
    ? body.policy
    : [];

  const actor = { id: session.user.id, email: session.user.email, role: session.user.role };
  const changed: Array<{ role: string; required: boolean }> = [];

  for (const entry of incoming) {
    if (!ROLES.includes(entry.role)) continue;
    // Enforce: ADMIN is always required.
    const required = entry.role === 'ADMIN' ? true : Boolean(entry.required);
    await prisma.mfaPolicy.upsert({
      where: { role: entry.role },
      update: { required },
      create: { role: entry.role, required },
    });
    changed.push({ role: entry.role, required });
  }

  await writeAudit({
    actor,
    action: 'mfa.policy_changed',
    entityType: 'MfaPolicy',
    metadata: { changes: changed },
    ...requestMeta(req),
  });

  return NextResponse.json({ ok: true, policy: changed });
}
