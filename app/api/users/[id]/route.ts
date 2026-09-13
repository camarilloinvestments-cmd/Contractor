export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';
import { countOtherActiveAdmins } from '@/lib/users/admin-ops';

// GET a single user's lifecycle detail (admin only).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, name: true, role: true, status: true,
      forcePasswordChange: true, workerId: true, createdAt: true,
      updatedAt: true, deactivatedAt: true, lastLoginAt: true,
    },
  });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(user);
}

// PATCH: edit basic profile fields (name, email, role, workerId). Audited.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const body = await request.json();
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const data: any = {};
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
    if (typeof body.email === 'string' && body.email.trim()) {
      const email = body.email.trim();
      if (email !== target.email) {
        const clash = await prisma.user.findUnique({ where: { email } });
        if (clash) return NextResponse.json({ error: 'Email already in use' }, { status: 400 });
        data.email = email;
      }
    }
    if (body.role && ['ADMIN', 'PROJECT_MANAGER', 'FIELD_WORKER'].includes(body.role)) {
      // Protect the last remaining active admin from being demoted.
      if (target.role === 'ADMIN' && body.role !== 'ADMIN') {
        const others = await countOtherActiveAdmins(target.id);
        if (others === 0) {
          return NextResponse.json({ error: 'Cannot change role: at least one active admin is required' }, { status: 400 });
        }
      }
      data.role = body.role;
    }
    if ('workerId' in body) data.workerId = body.workerId || null;

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No changes' }, { status: 400 });
    }

    const updated = await prisma.user.update({ where: { id }, data });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'user.update',
      entityType: 'User',
      entityId: id,
      metadata: { fields: Object.keys(data) },
      ...requestMeta(request),
    });
    return NextResponse.json({ id: updated.id, email: updated.email, name: updated.name, role: updated.role });
  } catch (err: any) {
    console.error('Update user error:', err);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

// DELETE: safe hard-delete with guards. Accounts/sessions cascade; historical
// audit rows keep the actor email (no FK) so the trail is preserved.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  if (id === session.user.id) {
    return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 });
  }
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (target.role === 'ADMIN') {
    const others = await countOtherActiveAdmins(target.id);
    if (others === 0) {
      return NextResponse.json({ error: 'Cannot delete the last active admin' }, { status: 400 });
    }
  }
  try {
    await prisma.user.delete({ where: { id } });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'user.delete',
      entityType: 'User',
      entityId: id,
      metadata: { email: target.email, role: target.role },
      ...requestMeta(request),
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Delete user error:', err);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}
