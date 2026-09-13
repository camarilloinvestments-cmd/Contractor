export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { writeAudit, requestMeta } from '@/lib/audit';

// Self-service password change. Clears any forcePasswordChange flag.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { currentPassword, newPassword } = (await request.json()) ?? {};
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Both current and new password are required' }, { status: 400 });
    }
    if (String(newPassword).length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 });
    }
    const user = await prisma.user.findUnique({ where: { id: session.user.id } });
    if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const ok = await bcrypt.compare(String(currentPassword), user.passwordHash);
    if (!ok) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });

    await prisma.user.update({
      where: { id: user.id },
      // Keep this session valid (no tokenVersion bump); just clear the flag.
      data: { passwordHash: await bcrypt.hash(String(newPassword), 12), forcePasswordChange: false },
    });
    await writeAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: 'user.self_password_change',
      entityType: 'User',
      entityId: user.id,
      ...requestMeta(request),
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Change password error:', err);
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 });
  }
}
