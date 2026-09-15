export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';
import { requireManage } from '@/lib/rbac';
import { createWithNumber } from '@/lib/documents/numbering';

// GET /api/ai-intake?status=NEEDS_REVIEW  -> list intakes (newest first)
export async function GET(request: Request) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const where: Record<string, unknown> = {};
  if (status) where.status = status;

  const intakes = await prisma.aiWorkIntake.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { items: true, sources: true } },
    },
    take: 200,
  });
  return NextResponse.json({ intakes });
}

// POST /api/ai-intake  -> create a NEW intake (no AI call yet)
export async function POST(request: Request) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const actor = gate.user;

  const body = await request.json().catch(() => ({}));
  if (!body?.primeContractorId) {
    return NextResponse.json({ error: 'primeContractorId is required' }, { status: 400 });
  }

  // Validate prime (and project, if supplied) exist and are consistent.
  const prime = await prisma.primeContractor.findUnique({ where: { id: body.primeContractorId } });
  if (!prime) return NextResponse.json({ error: 'Prime contractor not found' }, { status: 400 });
  if (body.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: body.projectId },
      select: { id: true, primeContractorId: true },
    });
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 400 });
    if (project.primeContractorId !== body.primeContractorId) {
      return NextResponse.json({ error: 'Project does not belong to the selected prime' }, { status: 400 });
    }
  }

  const intake = await createWithNumber('AI_INTAKE', (intakeNumber) =>
    prisma.aiWorkIntake.create({
      data: {
        intakeNumber,
        status: 'NEW',
        primeContractorId: body.primeContractorId,
        projectId: body.projectId ?? null,
        title: typeof body.title === 'string' ? body.title.slice(0, 300) : null,
        pastedText: typeof body.pastedText === 'string' ? body.pastedText : null,
        createdById: actor.id,
      },
    }),
  );

  await writeAudit({
    actor, action: 'ai_intake.created', entityType: 'AiWorkIntake', entityId: intake.id,
    metadata: { intakeNumber: intake.intakeNumber, primeContractorId: body.primeContractorId, projectId: body.projectId ?? null },
    ...requestMeta(request),
  });

  return NextResponse.json({ intake });
}
