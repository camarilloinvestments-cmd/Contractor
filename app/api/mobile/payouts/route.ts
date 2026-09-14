// Increment 10 — Workstream P: authorized payout visibility for the field worker.
// A worker may only see their OWN payout records. Amounts are read-only here.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyMobileSession } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const v = await verifyMobileSession(req);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const ctx = v.ctx;

  if (!ctx.workerId) return NextResponse.json({ payouts: [] });

  const payouts = await prisma.payoutRecord.findMany({
    where: { workerId: ctx.workerId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      totalAmount: true,
      status: true,
      notes: true,
      createdAt: true,
      tasks: { select: { id: true, description: true, costAmount: true } },
    },
  });

  return NextResponse.json({ payouts });
}
