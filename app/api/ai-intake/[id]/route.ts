export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeAudit, requestMeta } from '@/lib/audit';
import { requireManage } from '@/lib/rbac';

type Params = { params: Promise<{ id: string }> };

// GET /api/ai-intake/:id -> full intake with sources + items
export async function GET(_request: Request, { params }: Params) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const { id } = await params;

  const intake = await prisma.aiWorkIntake.findUnique({
    where: { id },
    include: {
      sources: { orderBy: { createdAt: 'asc' } },
      items: { orderBy: { orderIndex: 'asc' } },
    },
  });
  if (!intake) return NextResponse.json({ error: 'Intake not found' }, { status: 404 });
  return NextResponse.json({ intake });
}

// PATCH /api/ai-intake/:id -> operator edits to the draft (never AI).
// Accepts { title?, pastedText?, items: [{ id, instructions?, proposedType?,
//   routeSection?, mappedTaskTypeId?, confirmedJobCode?, quantity?, reviewStatus? }] }
export async function PATCH(request: Request, { params }: Params) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const actor = gate.user;
  const { id } = await params;

  const intake = await prisma.aiWorkIntake.findUnique({ where: { id }, include: { items: true } });
  if (!intake) return NextResponse.json({ error: 'Intake not found' }, { status: 404 });
  if (intake.status === 'IMPORTED' || intake.status === 'REJECTED') {
    return NextResponse.json({ error: 'Intake is finalized and can no longer be edited' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const ownItemIds = new Set(intake.items.map((it) => it.id));

  const intakeData: Record<string, unknown> = {};
  if (typeof body.title === 'string') intakeData.title = body.title.slice(0, 300);
  if (typeof body.pastedText === 'string') intakeData.pastedText = body.pastedText;

  const itemUpdates = Array.isArray(body.items) ? body.items : [];
  const ops: any[] = [];
  for (const upd of itemUpdates) {
    if (!upd?.id || !ownItemIds.has(upd.id)) continue; // isolation: only this intake's items
    const data: Record<string, unknown> = {};
    if (typeof upd.instructions === 'string') data.instructions = upd.instructions;
    if (typeof upd.proposedType === 'string') data.proposedType = upd.proposedType;
    if (typeof upd.routeSection === 'string') data.routeSection = upd.routeSection;
    if (typeof upd.mappedTaskTypeId === 'string') data.mappedTaskTypeId = upd.mappedTaskTypeId;
    if (typeof upd.confirmedJobCode === 'string') data.confirmedJobCode = upd.confirmedJobCode;
    if (upd.quantity === null || typeof upd.quantity === 'number') data.quantity = upd.quantity;
    if (typeof upd.reviewStatus === 'string') data.reviewStatus = upd.reviewStatus;
    if (Object.keys(data).length === 0) continue;
    ops.push(prisma.aiIntakeItem.update({ where: { id: upd.id }, data }));
  }

  if (Object.keys(intakeData).length > 0) {
    ops.push(prisma.aiWorkIntake.update({ where: { id }, data: intakeData }));
  }
  if (ops.length > 0) await prisma.$transaction(ops);

  await writeAudit({
    actor, action: 'ai_intake.edited', entityType: 'AiWorkIntake', entityId: id,
    metadata: { editedItems: itemUpdates.length }, ...requestMeta(request),
  });

  const updated = await prisma.aiWorkIntake.findUnique({
    where: { id },
    include: { sources: { orderBy: { createdAt: 'asc' } }, items: { orderBy: { orderIndex: 'asc' } } },
  });
  return NextResponse.json({ intake: updated });
}
