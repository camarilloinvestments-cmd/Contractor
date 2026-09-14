// Next.js 16 request proxy (formerly middleware). ALWAYS runs on the Node.js
// runtime, so it reads the authoritative maintenance flag straight from the
// database via lib/maintenance-state.
//
// Responsibility: while UpdateSettings.maintenanceMode is ON, reject ordinary
// mutating product API requests (POST/PUT/PATCH/DELETE) with an operator-safe
// HTTP 503, EXCEPT the recovery/update control plane (health, auth/login, MFA,
// Update Center + maintenance toggle) so an admin can always recover and turn
// maintenance back off. Read requests and non-API routes pass through; the
// server-rendered banner communicates maintenance to browsers.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isGatedRequest, MAINTENANCE_503_BODY } from '@/lib/maintenance';
import { isMaintenanceActive } from '@/lib/maintenance-state';

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only mutating, non-recovery API calls are ever candidates for the gate.
  if (!isGatedRequest(req.method, pathname)) {
    return NextResponse.next();
  }

  if (await isMaintenanceActive()) {
    return NextResponse.json(MAINTENANCE_503_BODY, {
      status: 503,
      headers: { 'Retry-After': '120', 'Cache-Control': 'no-store' },
    });
  }

  return NextResponse.next();
}

// Scope the proxy to API routes; page GETs are handled by the banner. This keeps
// the gate off Next internals (/_next/*) and static assets entirely.
export const config = {
  matcher: ['/api/:path*'],
};
