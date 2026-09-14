// Domain & SSL — public IP discovery. ADMIN only.
// GET: detect (override wins, else auto-detect — LIVE-VM for auto).
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/domains/guard';
import { detectPublicIp } from '@/lib/domains/network';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const ipv4 = url.searchParams.get('ipv4');
  const ipv6 = url.searchParams.get('ipv6');

  const result = await detectPublicIp({ ipv4, ipv6 });
  return NextResponse.json({ publicIp: result });
}
