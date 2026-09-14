// Centralized role-based access control (Security remediation, Section D).
// Canonical auth + role guards for App Router route handlers. Handlers call
// one of the require* helpers and short-circuit on the returned NextResponse:
//
//   const gate = await requireManage();
//   if ('res' in gate) return gate.res;
//   const { user } = gate; // typed, role-checked
//
// This replaces the ~30 duplicated local `canManage` definitions and closes
// privilege-escalation gaps where mutation routes only checked authentication.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';

export type Role = 'ADMIN' | 'PROJECT_MANAGER' | 'FIELD_WORKER';

export interface RbacUser {
  id: string;
  email: string;
  role: Role;
  name?: string | null;
}

export type Gate = { user: RbacUser } | { res: NextResponse };

export function isAdmin(role?: string | null): boolean {
  return role === 'ADMIN';
}

// ADMIN or PROJECT_MANAGER may manage operational/financial data.
export function canManage(role?: string | null): boolean {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function forbidden(): NextResponse {
  return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 });
}

// Any authenticated user.
export async function requireAuth(): Promise<Gate> {
  const session = await auth();
  if (!session?.user) return { res: unauthorized() };
  return { user: session.user as RbacUser };
}

// Restrict to a specific set of roles.
export async function requireRole(roles: Role[]): Promise<Gate> {
  const session = await auth();
  if (!session?.user) return { res: unauthorized() };
  const user = session.user as RbacUser;
  if (!roles.includes(user.role)) return { res: forbidden() };
  return { user };
}

// ADMIN or PROJECT_MANAGER.
export async function requireManage(): Promise<Gate> {
  return requireRole(['ADMIN', 'PROJECT_MANAGER']);
}

// ADMIN only.
export async function requireAdmin(): Promise<Gate> {
  return requireRole(['ADMIN']);
}
