export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';
import type { Prisma } from '@prisma/client';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

// POST: clone a workflow (and its latest version's config) to a target prime contractor.
// Body: { targetPrimeContractorId, name }
// Proves acceptance step 8: a workflow can be reused for a new prime with NO core code change.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await params;

  try {
    const body = await request.json();
    const { targetPrimeContractorId, name } = body ?? {};
    if (!targetPrimeContractorId || !name) {
      return NextResponse.json({ error: 'targetPrimeContractorId and name are required' }, { status: 400 });
    }

    const source = await prisma.documentationWorkflow.findUnique({
      where: { id },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!source) return NextResponse.json({ error: 'Source workflow not found' }, { status: 404 });

    const target = await prisma.primeContractor.findUnique({ where: { id: targetPrimeContractorId } });
    if (!target) return NextResponse.json({ error: 'Target prime contractor not found' }, { status: 404 });

    const latest = source.versions[0];

    const clone = await prisma.documentationWorkflow.create({
      data: {
        primeContractorId: targetPrimeContractorId,
        name,
        workType: source.workType,
        projectType: source.projectType,
        status: 'DRAFT',
        versions: {
          create: {
            version: 1,
            status: 'DRAFT',
            config: (latest?.config ?? {}) as unknown as Prisma.InputJsonValue,
            requireCloseoutBeforeInvoice: latest?.requireCloseoutBeforeInvoice ?? false,
          },
        },
      },
      include: { versions: true },
    });

    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'docWorkflow.clone',
      entityType: 'DocumentationWorkflow',
      entityId: clone.id,
      metadata: { sourceId: id, targetPrimeContractorId, name },
      ...requestMeta(request),
    });

    return NextResponse.json(clone);
  } catch (err: any) {
    console.error('Clone workflow error:', err);
    return NextResponse.json({ error: 'Failed to clone workflow' }, { status: 500 });
  }
}
