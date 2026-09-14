export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';
import { normalizeConfig } from '@/lib/closeout/workflow-config';
import type { Prisma } from '@prisma/client';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

// POST: create a new version of a workflow. By default clones config from the latest
// version and bumps the version number. Never overwrites historical versions.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await params;

  try {
    const workflow = await prisma.documentationWorkflow.findUnique({
      where: { id },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!workflow) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const latest = workflow.versions[0];
    const nextVersion = (latest?.version ?? 0) + 1;
    const cfg = body?.config
      ? normalizeConfig(body.config)
      : normalizeConfig(latest?.config ?? null);

    const version = await prisma.documentationWorkflowVersion.create({
      data: {
        workflowId: id,
        version: nextVersion,
        status: 'DRAFT',
        config: cfg as unknown as Prisma.InputJsonValue,
        requireCloseoutBeforeInvoice: body?.requireCloseoutBeforeInvoice ?? latest?.requireCloseoutBeforeInvoice ?? false,
        effectiveDate: body?.effectiveDate ? new Date(body.effectiveDate) : null,
        expirationDate: body?.expirationDate ? new Date(body.expirationDate) : null,
      },
    });

    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'docWorkflow.versionCreate',
      entityType: 'DocumentationWorkflowVersion',
      entityId: version.id,
      metadata: { workflowId: id, version: nextVersion },
      ...requestMeta(request),
    });

    return NextResponse.json(version);
  } catch (err: any) {
    console.error('Create workflow version error:', err);
    return NextResponse.json({ error: 'Failed to create version' }, { status: 500 });
  }
}
