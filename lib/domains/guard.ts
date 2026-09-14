// Shared authorization + CSRF guard for Domain & SSL API routes (§17).
//
// Every Domain & SSL route is ADMIN-only. Mutating routes additionally require a
// same-origin request (a lightweight CSRF defense for cookie-authenticated
// actions): the browser-sent Origin/Referer must match the request host. This
// pairs with SameSite session cookies; there is no cross-origin form path.
import { NextResponse } from 'next/server';
import { auth } from '@/auth';

export type GuardOk = {
  ok: true;
  actor: { id?: string | null; email?: string | null; role?: string | null };
};
export type GuardFail = { ok: false; response: NextResponse };

/** Require an authenticated ADMIN. Returns the actor or a 401 response. */
export async function requireAdmin(): Promise<GuardOk | GuardFail> {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { ok: true, actor: { id: session.user.id, email: session.user.email, role: session.user.role } };
}

/**
 * Same-origin check for mutating requests. Rejects when the Origin (or, as a
 * fallback, Referer) host does not match the request host. This blocks
 * cross-site form/fetch CSRF against cookie-authenticated endpoints.
 */
export function sameOrigin(req: Request): boolean {
  const host = req.headers.get('host');
  if (!host) return false;
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const candidate = origin || referer;
  if (!candidate) {
    // No Origin/Referer at all: reject for mutating actions (be strict).
    return false;
  }
  try {
    const u = new URL(candidate);
    return u.host === host;
  } catch {
    return false;
  }
}

/** Combined guard for mutating routes: ADMIN + same-origin. */
export async function requireAdminMutation(req: Request): Promise<GuardOk | GuardFail> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  if (!sameOrigin(req)) {
    return { ok: false, response: NextResponse.json({ error: 'Invalid origin' }, { status: 403 }) };
  }
  return admin;
}
