// Increment 10 — Workstream P: current mobile user/device profile.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyMobileSession } from '@/lib/mobile/auth';
import { PRODUCT_NAME, APP_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const v = await verifyMobileSession(req);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const worker = v.ctx.workerId
    ? await prisma.worker.findUnique({ where: { id: v.ctx.workerId }, include: { crew: true } })
    : null;
  return NextResponse.json({
    user: { id: v.ctx.userId, email: v.ctx.email, name: v.ctx.name, role: v.ctx.role },
    worker: worker
      ? { id: worker.id, name: worker.name, workerType: worker.workerType, companyName: worker.companyName, crew: worker.crew ? { id: worker.crew.id, name: worker.crew.name } : null }
      : null,
    device: { id: v.ctx.deviceId, uuid: v.ctx.deviceUuid },
    server: { product: PRODUCT_NAME, version: APP_VERSION },
  });
}
