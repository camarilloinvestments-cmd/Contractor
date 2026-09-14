// Application maintenance gate — shared, runtime-agnostic helpers.
//
// The AUTHORITATIVE maintenance flag is UpdateSettings.maintenanceMode in the
// database (see lib/maintenance-state.ts for the cached reader). This module
// holds only pure logic (no DB, no secrets) so it is safe to import anywhere:
// the request proxy, server components and the acceptance harness.
//
// When maintenance is ON we reject ordinary mutating product API requests with
// HTTP 503 so no writes can land during a migration/cutover window. A small
// allow-list keeps the recovery/update control plane reachable so an operator
// can always log in, inspect the failure stage, recover and turn maintenance
// back OFF — i.e. we can never lock ourselves out of disabling maintenance.

export const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

export function isMutatingMethod(method: string | undefined | null): boolean {
  if (!method) return false;
  return (MUTATING_METHODS as readonly string[]).includes(method.toUpperCase());
}

// Control-plane / recovery API prefixes that must NEVER be blocked while
// maintenance is ON. Kept intentionally minimal:
//  - /api/health            liveness/readiness probe (also used by the updater)
//  - /api/auth              NextAuth session + credential login (recovery login)
//  - /api/mfa               MFA challenge completed during recovery login
//  - /api/system/updates    Update Center: status, install, rollback, retry AND
//                           the maintenance toggle (/api/system/updates/maintenance)
// Everything else (ordinary product APIs, mobile write sync, portal submits,
// etc.) is subject to the 503 gate.
export const MAINTENANCE_ALLOW_PREFIXES = [
  '/api/health',
  '/api/auth',
  '/api/mfa',
  '/api/system/updates',
] as const;

export function isRecoveryPath(pathname: string): boolean {
  return MAINTENANCE_ALLOW_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
}

// True when this request must be blocked IF maintenance is currently active.
// (Whether maintenance is active is decided by the caller via the DB reader.)
export function isGatedRequest(method: string, pathname: string): boolean {
  if (!pathname.startsWith('/api/')) return false;
  if (!isMutatingMethod(method)) return false;
  if (isRecoveryPath(pathname)) return false;
  return true;
}

export const MAINTENANCE_503_BODY = { error: 'System maintenance in progress' } as const;
