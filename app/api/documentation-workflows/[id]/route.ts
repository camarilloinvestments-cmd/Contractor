export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

// GET: workflow detail with all versions.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const workflow = await prisma.documentationWorkflow.findUnique({
    where: { id },
    include: {
      primeContractor: { select: { id: true, companyName: true } },
      versions: {
        orderBy: { version: 'desc' },
        include: { _count: { select: { jobs: true } } },
      },
    },
  });
  if (!workflow) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(workflow);
}

// PATCH: update workflow metadata (name, workType, projectType, status).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await params;

  try {
    const body = await request.json();
    const { name, workType, projectType, status } = body ?? {};
    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (workType !== undefined) data.workType = workType || null;
    if (projectType !== undefined) data.projectType = projectType || null;
    if (status !== undefined) {
      if (!['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      data.status = status;
    }

    const workflow = await prisma.documentationWorkflow.update({ where: { id }, data });

    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'docWorkflow.update',
      entityType: 'DocumentationWorkflow',
      entityId: id,
      metadata: data,
      ...requestMeta(request),
    });

    return NextResponse.json(workflow);
  } catch (err: any) {
    console.error('Update documentation workflow error:', err);
    return NextResponse.json({ error: 'Failed to update workflow' }, { status: 500 });
  }
}
