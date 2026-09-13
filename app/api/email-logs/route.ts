export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

// Recent outbound email delivery log (admin only).
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const take = Math.min(Number(url.searchParams.get('take') ?? 50) || 50, 200);
  let logs: any[] = [];
  try {
    logs = await prisma.emailLog.findMany({ orderBy: { createdAt: 'desc' }, take });
  } catch {
    logs = [];
  }
  return NextResponse.json({ logs });
}
