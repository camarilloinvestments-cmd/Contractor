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

// PATCH: update a workflow version (config, status, gating, dates).
// Activating a version archives sibling ACTIVE versions so only one is active at a time.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id, versionId } = await params;

  try {
    const existing = await prisma.documentationWorkflowVersion.findUnique({ where: { id: versionId } });
    if (!existing || existing.workflowId !== id) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }

    const body = await request.json();
    const data: Prisma.DocumentationWorkflowVersionUpdateInput = {};
    if (body?.config !== undefined) {
      data.config = normalizeConfig(body.config) as unknown as Prisma.InputJsonValue;
    }
    if (body?.requireCloseoutBeforeInvoice !== undefined) {
      data.requireCloseoutBeforeInvoice = !!body.requireCloseoutBeforeInvoice;
    }
    if (body?.effectiveDate !== undefined) {
      data.effectiveDate = body.effectiveDate ? new Date(body.effectiveDate) : null;
    }
    if (body?.expirationDate !== undefined) {
      data.expirationDate = body.expirationDate ? new Date(body.expirationDate) : null;
    }
    if (body?.status !== undefined) {
      if (!['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(body.status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      data.status = body.status;
    }

    // When activating, archive other active versions of the same workflow and mark parent ACTIVE.
    if (body?.status === 'ACTIVE') {
      await prisma.$transaction([
        prisma.documentationWorkflowVersion.updateMany({
          where: { workflowId: id, status: 'ACTIVE', id: { not: versionId } },
          data: { status: 'ARCHIVED' },
        }),
        prisma.documentationWorkflow.update({ where: { id }, data: { status: 'ACTIVE' } }),
      ]);
    }

    const version = await prisma.documentationWorkflowVersion.update({ where: { id: versionId }, data });

    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'docWorkflow.versionUpdate',
      entityType: 'DocumentationWorkflowVersion',
      entityId: versionId,
      metadata: { workflowId: id, status: body?.status },
      ...requestMeta(request),
    });

    return NextResponse.json(version);
  } catch (err: any) {
    console.error('Update workflow version error:', err);
    return NextResponse.json({ error: 'Failed to update version' }, { status: 500 });
  }
}
