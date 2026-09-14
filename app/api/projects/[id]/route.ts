export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getProject, updateProject, setProjectDefaults } from '@/lib/projects';
import { writeAudit, requestMeta } from '@/lib/audit';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const project = await getProject(id);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(project);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const body = await req.json();
    // Dedicated default book/version setter (auto-resolves active version).
    if (body?.action === 'setDefaults') {
      const updated = await setProjectDefaults(id, {
        defaultPriceBookId: body.defaultPriceBookId ?? null,
        defaultPriceBookVersionId: body.defaultPriceBookVersionId ?? null,
      });
      await writeAudit({
        actor: { id: session.user.id, email: session.user.email, role: session.user.role },
        action: 'project.set_defaults', entityType: 'Project', entityId: id,
        metadata: { defaultPriceBookId: updated.defaultPriceBookId, defaultPriceBookVersionId: updated.defaultPriceBookVersionId },
        ...requestMeta(req),
      });
      return NextResponse.json(updated);
    }
    const updated = await updateProject(id, {
      projectCode: body.projectCode,
      projectName: body.projectName,
      description: body.description,
      status: body.status,
      defaultPriceBookId: body.defaultPriceBookId,
      defaultPriceBookVersionId: body.defaultPriceBookVersionId,
    });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'project.update', entityType: 'Project', entityId: id, ...requestMeta(req),
    });
    return NextResponse.json(updated);
  } catch (err: any) {
    console.error('Update project error:', err?.message);
    return NextResponse.json({ error: err?.message || 'Failed to update project' }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const jobCount = await prisma.job.count({ where: { projectId: id } });
    if (jobCount > 0) {
      return NextResponse.json({ error: 'Cannot delete a project with work orders; archive it instead' }, { status: 400 });
    }
    await prisma.project.delete({ where: { id } });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'project.delete', entityType: 'Project', entityId: id, ...requestMeta(req),
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Delete project error:', err?.message);
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 400 });
  }
}
