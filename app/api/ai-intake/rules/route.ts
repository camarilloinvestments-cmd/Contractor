export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';
import { requireManage } from '@/lib/rbac';

// Prime/Project-scoped terminology & business rules. These are NEVER universal:
// a rule only applies to its prime (and optionally a specific project).

// GET /api/ai-intake/rules?primeContractorId=..&projectId=..
export async function GET(request: Request) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;

  const { searchParams } = new URL(request.url);
  const primeContractorId = searchParams.get('primeContractorId');
  const projectId = searchParams.get('projectId');
  if (!primeContractorId) {
    return NextResponse.json({ error: 'primeContractorId is required' }, { status: 400 });
  }
  const rules = await prisma.primeProjectAiRule.findMany({
    where: {
      primeContractorId,
      OR: [{ projectId: null }, ...(projectId ? [{ projectId }] : [])],
    },
    orderBy: [{ ruleType: 'asc' }, { term: 'asc' }],
  });
  return NextResponse.json({ rules });
}

// POST /api/ai-intake/rules  { primeContractorId, projectId?, ruleType, term, definition }
export async function POST(request: Request) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const actor = gate.user;

  const body = await request.json().catch(() => ({}));
  if (!body?.primeContractorId || !body?.ruleType || !body?.term || !body?.definition) {
    return NextResponse.json({ error: 'primeContractorId, ruleType, term, definition are required' }, { status: 400 });
  }
  const rule = await prisma.primeProjectAiRule.upsert({
    where: {
      primeContractorId_projectId_ruleType_term: {
        primeContractorId: body.primeContractorId,
        projectId: body.projectId ?? null,
        ruleType: body.ruleType,
        term: body.term,
      },
    },
    create: {
      primeContractorId: body.primeContractorId,
      projectId: body.projectId ?? null,
      ruleType: body.ruleType,
      term: body.term,
      definition: body.definition,
      active: body.active !== false,
      createdById: actor.id,
    },
    update: {
      definition: body.definition,
      active: body.active !== false,
    },
  });
  await writeAudit({
    actor, action: 'ai_intake.rule_saved', entityType: 'PrimeProjectAiRule', entityId: rule.id,
    metadata: { ruleType: rule.ruleType, term: rule.term, projectId: rule.projectId }, ...requestMeta(request),
  });
  return NextResponse.json({ rule });
}

// DELETE /api/ai-intake/rules?id=..
export async function DELETE(request: Request) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const actor = gate.user;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  await prisma.primeProjectAiRule.delete({ where: { id } });
  await writeAudit({
    actor, action: 'ai_intake.rule_deleted', entityType: 'PrimeProjectAiRule', entityId: id,
    metadata: {}, ...requestMeta(request),
  });
  return NextResponse.json({ ok: true });
}
