export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

// GET: resolve the workflow version currently pinned to the job.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const job = await prisma.job.findUnique({
    where: { id },
    select: {
      id: true,
      documentationWorkflowVersionId: true,
      documentationWorkflowVersion: {
        include: { workflow: { select: { id: true, name: true, primeContractorId: true } } },
      },
    },
  });
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  return NextResponse.json(job);
}

// POST: pin a workflow version to a job. Body accepts either { workflowVersionId }
// (explicit pin) or { workflowId } (resolves that workflow's ACTIVE version).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await params;

  try {
    const job = await prisma.job.findUnique({ where: { id }, select: { id: true, primeContractorId: true } });
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

    const body = await request.json();
    let versionId: string | null = body?.workflowVersionId ?? null;

    if (!versionId && body?.workflowId) {
      const active = await prisma.documentationWorkflowVersion.findFirst({
        where: { workflowId: body.workflowId, status: 'ACTIVE' },
        orderBy: { version: 'desc' },
        select: { id: true },
      });
      if (!active) {
        return NextResponse.json({ error: 'No ACTIVE version for that workflow' }, { status: 400 });
      }
      versionId = active.id;
    }

    if (versionId === null && body?.clear !== true) {
      return NextResponse.json({ error: 'workflowVersionId or workflowId required' }, { status: 400 });
    }

    const updated = await prisma.job.update({
      where: { id },
      data: { documentationWorkflowVersionId: body?.clear === true ? null : versionId },
      select: { id: true, documentationWorkflowVersionId: true },
    });

    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'job.workflowAssign',
      entityType: 'Job',
      entityId: id,
      metadata: { documentationWorkflowVersionId: updated.documentationWorkflowVersionId },
      ...requestMeta(request),
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    console.error('Assign job workflow error:', err);
    return NextResponse.json({ error: 'Failed to assign workflow' }, { status: 500 });
  }
}
