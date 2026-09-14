export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { listProjects, createProject } from '@/lib/projects';
import { writeAudit, requestMeta } from '@/lib/audit';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

// List projects, optionally scoped to a prime contractor (?primeId=...).
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const primeId = searchParams.get('primeId') || undefined;
  const projects = await listProjects(primeId);
  return NextResponse.json(projects);
}

// Create a project (scoped + unique within a prime).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json();
    if (!body?.primeContractorId || !body?.projectCode) {
      return NextResponse.json({ error: 'primeContractorId and projectCode are required' }, { status: 400 });
    }
    const project = await createProject({
      primeContractorId: body.primeContractorId,
      projectCode: body.projectCode,
      projectName: body.projectName ?? null,
      description: body.description ?? null,
      status: body.status ?? 'ACTIVE',
      defaultPriceBookId: body.defaultPriceBookId ?? null,
      defaultPriceBookVersionId: body.defaultPriceBookVersionId ?? null,
      createdById: session.user.id,
    });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'project.create', entityType: 'Project', entityId: project.id,
      metadata: { projectCode: project.projectCode, prime: project.primeContractorId },
      ...requestMeta(req),
    });
    return NextResponse.json(project);
  } catch (err: any) {
    console.error('Create project error:', err?.message);
    return NextResponse.json({ error: err?.message || 'Failed to create project' }, { status: 400 });
  }
}
