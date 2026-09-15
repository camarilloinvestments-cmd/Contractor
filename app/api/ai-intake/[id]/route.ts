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

// Validated operator resolution values for a flagged item (Blocker 3). Only
// these enum values are accepted from the client - never a free-form string.
const REVIEW_RESOLUTIONS = ['PENDING', 'CONFIRMED', 'CORRECTED', 'EXCLUDED'] as const;
type ReviewResolution = (typeof REVIEW_RESOLUTIONS)[number];
function isReviewResolution(v: unknown): v is ReviewResolution {
  return typeof v === 'string' && (REVIEW_RESOLUTIONS as readonly string[]).includes(v);
}

// PATCH /api/ai-intake/:id -> operator edits to the draft (never AI).
// Accepts { title?, pastedText?, items: [{ id, instructions?, proposedType?,
//   routeSection?, mappedTaskTypeId?, confirmedJobCode?, quantity?, reviewStatus?,
//   reviewResolution?, reviewNote? }] }
export async function PATCH(request: Request, { params }: Params) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const actor = gate.user;
  const { id } = await params;

  const intake = await prisma.aiWorkIntake.findUnique({ where: { id }, include: { items: true } });
  if (!intake) return NextResponse.json({ error: 'Intake not found' }, { status: 404 });
  // Finalized / terminal states can never be edited.
  if (intake.status === 'IMPORTED' || intake.status === 'REJECTED') {
    return NextResponse.json({ error: 'Intake is finalized and can no longer be edited' }, { status: 400 });
  }
  // In-flight states: an approval is claiming/converting the intake (APPROVING),
  // or an analysis is actively (re)writing its draft/items (ANALYZING). Editing
  // now would let source/draft/resolutions mutate underneath that operation and
  // could race the transactional review gate - reject the edit.
  if (intake.status === 'APPROVING' || intake.status === 'ANALYZING') {
    return NextResponse.json(
      { error: `Intake is currently ${intake.status.toLowerCase()} and cannot be edited until it settles` },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const ownItemIds = new Set(intake.items.map((it) => it.id));
  const oldItemById = new Map(intake.items.map((it) => [it.id, it]));
  // Blocker/Item 3 - per-item review-decision audit trail. Records who changed a
  // flagged item's resolution and from what to what. Never includes source or
  // AI document content - only the resolution transition + bounded note.
  const reviewDecisions: Array<{
    itemId: string;
    deviceId: string | null;
    oldResolution: string;
    newResolution: string;
    reviewedBy: string;
    reviewNotePresent: boolean;
    reviewNote: string | null;
  }> = [];

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
    // Blocker 3 - persisted, validated review resolution. Reject anything that
    // is not one of the approved enum values (400) rather than storing junk.
    if (upd.reviewResolution !== undefined) {
      if (!isReviewResolution(upd.reviewResolution)) {
        return NextResponse.json(
          { error: `Invalid reviewResolution; must be one of ${REVIEW_RESOLUTIONS.join(', ')}` },
          { status: 400 },
        );
      }
      data.reviewResolution = upd.reviewResolution;
      // Audit the resolver for any non-PENDING (explicit) decision.
      if (upd.reviewResolution === 'PENDING') {
        data.reviewedById = null;
        data.reviewedAt = null;
      } else {
        data.reviewedById = actor.id;
        data.reviewedAt = new Date();
      }
      // Capture the resolution transition for the audit trail (only when it
      // actually changes vs the persisted row).
      const old = oldItemById.get(upd.id);
      const oldResolution = old?.reviewResolution ?? 'PENDING';
      if (oldResolution !== upd.reviewResolution) {
        const notePresent =
          typeof upd.reviewNote === 'string' && upd.reviewNote.trim().length > 0;
        reviewDecisions.push({
          itemId: upd.id,
          deviceId: old?.deviceId ?? null,
          oldResolution,
          newResolution: upd.reviewResolution,
          reviewedBy: actor.id,
          reviewNotePresent: notePresent,
          reviewNote: notePresent ? String(upd.reviewNote).slice(0, 200) : null,
        });
      }
    }
    if (typeof upd.reviewNote === 'string') data.reviewNote = upd.reviewNote.slice(0, 2000);
    else if (upd.reviewNote === null) data.reviewNote = null;
    if (Object.keys(data).length === 0) continue;
    ops.push(prisma.aiIntakeItem.update({ where: { id: upd.id }, data }));
  }

  if (Object.keys(intakeData).length > 0) {
    ops.push(prisma.aiWorkIntake.update({ where: { id }, data: intakeData }));
  }
  if (ops.length > 0) await prisma.$transaction(ops);

  await writeAudit({
    actor, action: 'ai_intake.edited', entityType: 'AiWorkIntake', entityId: id,
    metadata: {
      editedItems: itemUpdates.length,
      reviewDecisionCount: reviewDecisions.length,
      reviewDecisions,
    },
    ...requestMeta(request),
  });

  const updated = await prisma.aiWorkIntake.findUnique({
    where: { id },
    include: { sources: { orderBy: { createdAt: 'asc' } }, items: { orderBy: { orderIndex: 'asc' } } },
  });
  return NextResponse.json({ intake: updated });
}
