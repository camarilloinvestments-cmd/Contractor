// Shared, state-locked draft-edit mutation path for an AI intake.
//
// This is the ONE authoritative implementation of an operator draft edit
// (title / pastedText / per-item fields incl. review resolution). Both the PATCH
// route and the concurrency integration tests call THIS function, so the tests
// exercise the real state-lock, not a shortcut that bypasses it.
//
// The allowed-state check and the item writes happen inside a SINGLE
// transaction: claimForDraftEdit() conditionally acquires the parent row (only
// if it is currently draft-mutable) and holds its lock for the rest of the
// transaction. That serializes this edit against the approval/analysis claims,
// which condition on the same row. If the intake is not draft-mutable (e.g. an
// approval already moved it to APPROVING), the claim matches zero rows and
// IntakeStateLockError is thrown -> HTTP 409.
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import type { ActorMeta, ReqMeta } from './analyze';
import { claimForDraftEdit } from './state-lock';

export const REVIEW_RESOLUTIONS = ['PENDING', 'CONFIRMED', 'CORRECTED', 'EXCLUDED'] as const;
export type ReviewResolution = (typeof REVIEW_RESOLUTIONS)[number];
export function isReviewResolution(v: unknown): v is ReviewResolution {
  return typeof v === 'string' && (REVIEW_RESOLUTIONS as readonly string[]).includes(v);
}

export class IntakeNotFoundError extends Error {
  constructor() {
    super('Intake not found');
    this.name = 'IntakeNotFoundError';
  }
}

// Invalid client input (e.g. a bogus reviewResolution enum value) -> HTTP 400.
export class DraftEditValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DraftEditValidationError';
  }
}

export type DraftItemEdit = {
  id?: string;
  instructions?: unknown;
  proposedType?: unknown;
  routeSection?: unknown;
  mappedTaskTypeId?: unknown;
  confirmedJobCode?: unknown;
  quantity?: unknown;
  reviewStatus?: unknown;
  reviewResolution?: unknown;
  reviewNote?: unknown;
};

export type DraftEditInput = {
  title?: unknown;
  pastedText?: unknown;
  items?: DraftItemEdit[];
};

type ReviewDecision = {
  itemId: string;
  deviceId: string | null;
  oldResolution: string;
  newResolution: string;
  reviewedBy: string;
  reviewNotePresent: boolean;
  reviewNote: string | null;
};

const intakeInclude = {
  sources: { orderBy: { createdAt: 'asc' as const } },
  items: { orderBy: { orderIndex: 'asc' as const } },
};

// Apply an operator draft edit under the authoritative state lock. Throws
// IntakeNotFoundError (404), DraftEditValidationError (400), or
// IntakeStateLockError (409). Returns the refreshed intake.
export async function applyDraftEdit(
  intakeId: string,
  input: DraftEditInput,
  actor: ActorMeta,
  reqMeta: ReqMeta = {},
) {
  const intake = await prisma.aiWorkIntake.findUnique({
    where: { id: intakeId },
    include: { items: true },
  });
  if (!intake) throw new IntakeNotFoundError();

  const ownItemIds = new Set(intake.items.map((it) => it.id));
  const oldItemById = new Map(intake.items.map((it) => [it.id, it]));
  const reviewDecisions: ReviewDecision[] = [];

  const intakeData: Record<string, unknown> = {};
  if (typeof input.title === 'string') intakeData.title = input.title.slice(0, 300);
  if (typeof input.pastedText === 'string') intakeData.pastedText = input.pastedText;

  const itemUpdates = Array.isArray(input.items) ? input.items : [];
  const itemOps: { id: string; data: Record<string, unknown> }[] = [];
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
    if (upd.reviewResolution !== undefined) {
      if (!isReviewResolution(upd.reviewResolution)) {
        throw new DraftEditValidationError(
          `Invalid reviewResolution; must be one of ${REVIEW_RESOLUTIONS.join(', ')}`,
        );
      }
      data.reviewResolution = upd.reviewResolution;
      if (upd.reviewResolution === 'PENDING') {
        data.reviewedById = null;
        data.reviewedAt = null;
      } else {
        data.reviewedById = actor.id;
        data.reviewedAt = new Date();
      }
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
    itemOps.push({ id: upd.id, data });
  }

  const hasWrites = itemOps.length > 0 || Object.keys(intakeData).length > 0;

  // No-op edit: nothing to write, so nothing to serialize. Return current state.
  if (!hasWrites) {
    const current = await prisma.aiWorkIntake.findUnique({
      where: { id: intakeId },
      include: intakeInclude,
    });
    return current;
  }

  // Authoritative, serialized mutation. The claim is the FIRST statement and
  // conditions on draft-mutable status; it throws IntakeStateLockError (409) if
  // the intake is being analyzed/approved or is terminal.
  const updated = await prisma.$transaction(async (tx) => {
    await claimForDraftEdit(tx, intakeId);
    for (const op of itemOps) {
      await tx.aiIntakeItem.update({ where: { id: op.id }, data: op.data });
    }
    if (Object.keys(intakeData).length > 0) {
      await tx.aiWorkIntake.update({ where: { id: intakeId }, data: intakeData });
    }
    return tx.aiWorkIntake.findUnique({ where: { id: intakeId }, include: intakeInclude });
  });

  await writeAudit({
    actor,
    action: 'ai_intake.edited',
    entityType: 'AiWorkIntake',
    entityId: intakeId,
    metadata: {
      editedItems: itemUpdates.length,
      reviewDecisionCount: reviewDecisions.length,
      reviewDecisions,
    },
    ...reqMeta,
  });

  return updated;
}
