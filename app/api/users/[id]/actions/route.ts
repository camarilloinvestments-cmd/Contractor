export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { writeAudit, requestMeta } from '@/lib/audit';
import { countOtherActiveAdmins, generateTempPassword } from '@/lib/users/admin-ops';

// POST /api/users/:id/actions  { action, ...args }
// Lifecycle actions: deactivate, reactivate, unlock, reset-password,
// force-password-change, clear-force-password-change, revoke-sessions.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const isSelf = id === session.user.id;

  let body: any = {};
  try { body = await request.json(); } catch {}
  const action: string = body?.action;
  if (!action) return NextResponse.json({ error: 'Missing action' }, { status: 400 });

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const actor = { id: session.user.id, email: session.user.email, role: session.user.role };
  const meta = requestMeta(request);
  const audit = (a: string, metadata?: Record<string, unknown>) =>
    writeAudit({ actor, action: a, entityType: 'User', entityId: id, metadata, ...meta });

  try {
    switch (action) {
      case 'deactivate': {
        if (isSelf) return NextResponse.json({ error: 'You cannot deactivate your own account' }, { status: 400 });
        if (target.role === 'ADMIN' && (await countOtherActiveAdmins(target.id)) === 0) {
          return NextResponse.json({ error: 'Cannot deactivate the last active admin' }, { status: 400 });
        }
        await prisma.user.update({
          where: { id },
          data: { status: 'DEACTIVATED', deactivatedAt: new Date(), tokenVersion: { increment: 1 } },
        });
        await audit('user.deactivate', { email: target.email });
        return NextResponse.json({ ok: true });
      }
      case 'reactivate':
      case 'unlock': {
        await prisma.user.update({
          where: { id },
          data: { status: 'ACTIVE', deactivatedAt: null },
        });
        await audit(action === 'unlock' ? 'user.unlock' : 'user.reactivate', { email: target.email });
        return NextResponse.json({ ok: true });
      }
      case 'revoke-sessions': {
        await prisma.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });
        await audit('user.revoke_sessions', { email: target.email });
        return NextResponse.json({ ok: true });
      }
      case 'force-password-change': {
        await prisma.user.update({ where: { id }, data: { forcePasswordChange: true } });
        await audit('user.force_password_change', { email: target.email, value: true });
        return NextResponse.json({ ok: true });
      }
      case 'clear-force-password-change': {
        await prisma.user.update({ where: { id }, data: { forcePasswordChange: false } });
        await audit('user.force_password_change', { email: target.email, value: false });
        return NextResponse.json({ ok: true });
      }
      case 'reset-password': {
        const provided = typeof body.newPassword === 'string' && body.newPassword.length >= 8 ? body.newPassword : null;
        if (typeof body.newPassword === 'string' && body.newPassword.length > 0 && body.newPassword.length < 8) {
          return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
        }
        const generated = provided ? null : generateTempPassword();
        const plain = provided ?? generated!;
        const forceChange = body.forceChange !== false; // default true
        await prisma.user.update({
          where: { id },
          data: {
            passwordHash: await bcrypt.hash(plain, 12),
            forcePasswordChange: forceChange,
            tokenVersion: { increment: 1 }, // invalidate existing sessions after reset
          },
        });
        // Never log the password itself; only that a reset happened + whether generated.
        await audit('user.reset_password', { email: target.email, generated: !provided, forceChange });
        return NextResponse.json({ ok: true, generatedPassword: generated ?? undefined });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('User action error:', action, err);
    return NextResponse.json({ error: 'Action failed' }, { status: 500 });
  }
}
