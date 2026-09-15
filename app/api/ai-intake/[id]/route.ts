export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requestMeta } from '@/lib/audit';
import { requireManage } from '@/lib/rbac';
import {
  applyDraftEdit,
  IntakeNotFoundError,
  DraftEditValidationError,
} from '@/lib/ai-intake/draft-edit';
import { IntakeStateLockError } from '@/lib/ai-intake/state-lock';

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
//   routeSection?, mappedTaskTypeId?, confirmedJobCode?, quantity?, reviewStatus?,
//   reviewResolution?, reviewNote? }] }
//
// The allowed-state check and the item writes are performed atomically inside a
// single transaction by applyDraftEdit(): it conditionally claims the parent row
// (only while draft-mutable) and holds the lock through the writes, so this edit
// serializes against the approval/analysis claims and cannot act on a stale
// permission decision. A pre-transaction status check alone is NOT relied upon.
export async function PATCH(request: Request, { params }: Params) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const actor = gate.user;
  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  try {
    const updated = await applyDraftEdit(
      id,
      { title: body?.title, pastedText: body?.pastedText, items: body?.items },
      { id: actor.id, email: actor.email, role: actor.role },
      requestMeta(request),
    );
    return NextResponse.json({ intake: updated });
  } catch (err) {
    if (err instanceof IntakeNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof DraftEditValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof IntakeStateLockError) {
      // Intake is being analyzed/approved or is terminal - not draft-mutable.
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
