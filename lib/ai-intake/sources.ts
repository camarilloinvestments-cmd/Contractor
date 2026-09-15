// Shared, state-locked source add/remove path for an AI intake.
//
// Both the /sources route and the concurrency integration tests call these
// functions, so the tests exercise the real state lock. Registration/removal of
// a source is a DRAFT mutation and therefore uses the SAME claimForDraftEdit()
// guard as item edits: it fails closed while the intake is ANALYZING /
// APPROVING / IMPORTED / REJECTED.
//
// For uploads, the file is stored in object storage BEFORE the guarded DB
// registration (the caller uploads, then calls registerIntakeSource). If the
// state race is lost at registration time, IntakeStateLockError is thrown and
// the caller is expected to delete the just-uploaded object to avoid orphans.
import { prisma } from '@/lib/prisma';
import { claimForDraftEdit, IntakeStateLockError } from './state-lock';

export class IntakeSourceNotFoundError extends Error {
  constructor() {
    super('Source not found');
    this.name = 'IntakeSourceNotFoundError';
  }
}

export type NewSourceInput = {
  kind: string;
  originalFilename: string;
  contentType: string;
  storagePath: string;
  sizeBytes: number;
  sha256: string;
};

// Register a previously-uploaded source under the draft-edit state lock. Throws
// IntakeStateLockError (409) if the intake is not draft-mutable; the caller must
// then clean up the uploaded object.
export async function registerIntakeSource(intakeId: string, input: NewSourceInput) {
  return prisma.$transaction(async (tx) => {
    await claimForDraftEdit(tx, intakeId);
    return tx.aiIntakeSource.create({
      data: {
        intakeId,
        kind: input.kind,
        originalFilename: input.originalFilename,
        contentType: input.contentType,
        storagePath: input.storagePath,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        sentToAi: false,
      },
    });
  });
}

// Remove a source under the draft-edit state lock. Throws
// IntakeSourceNotFoundError (404) if the source does not belong to the intake,
// or IntakeStateLockError (409) if the intake is not draft-mutable.
export async function removeIntakeSource(intakeId: string, sourceId: string) {
  return prisma.$transaction(async (tx) => {
    await claimForDraftEdit(tx, intakeId);
    // Re-verify ownership INSIDE the locked transaction so a source cannot be
    // removed from the wrong intake or after a concurrent change.
    const source = await tx.aiIntakeSource.findUnique({ where: { id: sourceId } });
    if (!source || source.intakeId !== intakeId) {
      throw new IntakeSourceNotFoundError();
    }
    await tx.aiIntakeSource.delete({ where: { id: sourceId } });
    return { ok: true };
  });
}

export { IntakeStateLockError };
