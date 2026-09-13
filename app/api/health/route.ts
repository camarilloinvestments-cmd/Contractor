export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getVersionInfo } from '@/lib/version';

// Public health/version endpoint. Reports app version and DB connectivity.
export async function GET() {
  const info = getVersionInfo();
  let db = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = 'error';
  }
  const healthy = db === 'ok';
  return NextResponse.json(
    { status: healthy ? 'ok' : 'degraded', ...info, db, time: new Date().toISOString() },
    { status: healthy ? 200 : 503 }
  );
}
