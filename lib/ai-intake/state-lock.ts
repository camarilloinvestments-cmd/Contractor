// Authoritative intake state-lock guard (final state-lock correction).
//
// The AI intake lifecycle has several operations that read the intake state and
// then, in a separate step, write to the intake (draft edits, source add/delete,
// analysis, approval). Any read-then-write pair opens a TOCTOU window in which a
// concurrent operation can change the parent state after the permission check
// but before the write, letting two operations both believe they own the intake.
//
// This module closes that window. EVERY mutating operation acquires the intake
// through a conditional `updateMany` on the parent AiWorkIntake row, executed as
// the FIRST statement inside the SAME transaction as the mutation. Because all
// of these conditional updates target the SAME row, PostgreSQL row-level locking
// serializes them: whoever acquires the row lock first wins, and any waiter
// re-evaluates the WHERE predicate against the freshly committed row (READ
// COMMITTED), so it can no longer act on a stale permission decision.
//
// The claim also bumps a monotonic `revision` counter, giving a CAS-style,
// PostgreSQL-safe optimistic guard and a real column to write to (an empty
// update would not reliably take a row lock).
import { Prisma } from '@prisma/client';

// States in which an operator may edit the DRAFT (title / pastedText / items) or
// add/remove SOURCE files. Deliberately EXCLUDES:
//   ANALYZING  - an analysis owns the input set and is (re)writing the draft
//   APPROVING  - an approval is converting the intake into a Work Order
//   IMPORTED   - terminal: already converted
//   REJECTED   - terminal: discarded
export const MUTABLE_DRAFT_STATUSES = ['NEW', 'READY', 'NEEDS_REVIEW', 'FAILED'] as const;

// States from which an analysis run may be (re)claimed. Same set as draft-mutable
// today, but kept separate so the re-analysis policy can diverge without
// weakening the draft-edit gate. Excludes ANALYZING (already running),
// APPROVING/IMPORTED/REJECTED (owned by approval / terminal).
export const ANALYZABLE_STATUSES = ['NEW', 'FAILED', 'READY', 'NEEDS_REVIEW'] as const;

export type IntakeLockKind = 'draft-edit' | 'analysis';

// Thrown when the conditional claim matches zero rows (the intake is not in a
// state that permits the requested mutation, or a concurrent claim won the row).
// Routes map this to HTTP 409 (locked / conflict).
export class IntakeStateLockError extends Error {
  readonly currentStatus: string | null;
  readonly kind: IntakeLockKind;
  constructor(kind: IntakeLockKind, currentStatus: string | null, message: string) {
    super(message);
    this.name = 'IntakeStateLockError';
    this.kind = kind;
    this.currentStatus = currentStatus;
  }
}

type TxClient = Prisma.TransactionClient;

async function currentStatus(tx: TxClient, intakeId: string): Promise<string | null> {
  const row = await tx.aiWorkIntake.findUnique({
    where: { id: intakeId },
    select: { status: true },
  });
  return row?.status ?? null;
}

// Conditionally acquire the intake for a DRAFT / SOURCE mutation. MUST be the
// first write inside the transaction that performs the mutation. On success the
// caller holds the parent-row lock for the rest of the transaction, so an
// approval/analysis claim (which conditions on status too) cannot proceed until
// this transaction commits, and vice-versa. Throws IntakeStateLockError if the
// intake is not currently draft-mutable.
export async function claimForDraftEdit(tx: TxClient, intakeId: string): Promise<void> {
  const res = await tx.aiWorkIntake.updateMany({
    where: { id: intakeId, status: { in: [...MUTABLE_DRAFT_STATUSES] } },
    data: { revision: { increment: 1 } },
  });
  if (res.count !== 1) {
    const status = await currentStatus(tx, intakeId);
    if (status === null) {
      throw new IntakeStateLockError('draft-edit', null, 'Intake not found');
    }
    throw new IntakeStateLockError(
      'draft-edit',
      status,
      `Intake is currently ${status.toLowerCase()} and cannot be edited until it settles`,
    );
  }
}

// Conditionally claim the intake for ANALYSIS: atomically move an analyzable
// intake into ANALYZING. Only one caller can win; a second concurrent analysis
// matches zero rows and is refused. MUST run inside a transaction; the caller
// should read the sources/pasted text only AFTER this returns so the input set
// it analyzes is the one it owns.
export async function claimForAnalysis(tx: TxClient, intakeId: string): Promise<void> {
  const res = await tx.aiWorkIntake.updateMany({
    where: { id: intakeId, status: { in: [...ANALYZABLE_STATUSES] } },
    data: { status: 'ANALYZING', error: null, revision: { increment: 1 } },
  });
  if (res.count !== 1) {
    const status = await currentStatus(tx, intakeId);
    if (status === null) {
      throw new IntakeStateLockError('analysis', null, 'Intake not found');
    }
    if (status === 'ANALYZING') {
      throw new IntakeStateLockError(
        'analysis',
        status,
        'Analysis is already running for this intake',
      );
    }
    throw new IntakeStateLockError(
      'analysis',
      status,
      `Intake is currently ${status.toLowerCase()} and cannot be analyzed`,
    );
  }
}
