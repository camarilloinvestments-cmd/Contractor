export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';
import { COMCAST_CLOSEOUT_CONFIG, normalizeConfig } from '@/lib/closeout/workflow-config';
import type { Prisma } from '@prisma/client';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

// GET: list documentation workflows for a prime contractor (with version summaries).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const workflows = await prisma.documentationWorkflow.findMany({
    where: { primeContractorId: id },
    orderBy: { name: 'asc' },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        select: {
          id: true,
          version: true,
          status: true,
          effectiveDate: true,
          expirationDate: true,
          requireCloseoutBeforeInvoice: true,
          createdAt: true,
          _count: { select: { jobs: true } },
        },
      },
    },
  });
  return NextResponse.json(workflows);
}

// POST: create a documentation workflow with an initial DRAFT version 1.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await params;

  try {
    const prime = await prisma.primeContractor.findUnique({ where: { id } });
    if (!prime) return NextResponse.json({ error: 'Prime contractor not found' }, { status: 404 });

    const body = await request.json();
    const { name, workType, projectType, config } = body ?? {};
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Workflow name is required' }, { status: 400 });
    }

    const cfg = config ? normalizeConfig(config) : COMCAST_CLOSEOUT_CONFIG;

    const workflow = await prisma.documentationWorkflow.create({
      data: {
        primeContractorId: id,
        name,
        workType: workType || null,
        projectType: projectType || null,
        status: 'DRAFT',
        versions: {
          create: {
            version: 1,
            status: 'DRAFT',
            config: cfg as unknown as Prisma.InputJsonValue,
            requireCloseoutBeforeInvoice: false,
          },
        },
      },
      include: { versions: true },
    });

    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'docWorkflow.create',
      entityType: 'DocumentationWorkflow',
      entityId: workflow.id,
      metadata: { name, primeContractorId: id },
      ...requestMeta(request),
    });

    return NextResponse.json(workflow);
  } catch (err: any) {
    console.error('Create documentation workflow error:', err);
    return NextResponse.json({ error: 'Failed to create workflow' }, { status: 500 });
  }
}
