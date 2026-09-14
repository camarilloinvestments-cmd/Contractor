// Workstream G/J (Option A refactor): prime-contractor price books with a
// first-class, IMMUTABLE version entity (PriceBookVersion), plus internal rate
// books (subcontractor + in-house).
//
// A Price Book records what the PRIME pays US per opaque job/billing code. Codes
// are opaque and carry NO universal meaning: "A3" for one prime/project is a
// different scope/rate than "A3" for another. Codes are therefore scoped to a
// PriceBookVersion (unique on (priceBookVersionId, jobCode)) - never globally.
//
// Versioning rules (immutable/pinnable):
//  - A PriceBook owns 1..N PriceBookVersions. Lines live on a version.
//  - Versions 1/2/3 coexist. A new upload creates a NEW version; it NEVER
//    mutates or deletes lines of a version that is already in use.
//  - Existing work orders stay pinned to the version they were created against;
//    only new work orders pick up a newer version.
//  - Rate books record what WE PAY subcontractors / our own crews. They are kept
//    strictly separate from prime billing and must NEVER be mixed into prime
//    exports.
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export type PriceBookInput = {
  primeContractorId: string;
  name: string;
  projectId?: string | null;
  contract?: string | null;
  projectLabel?: string | null; // legacy free-text label (superseded by projectId)
  market?: string | null;
  region?: string | null;
  effectiveDate?: Date | null;
  expirationDate?: Date | null;
  notes?: string | null;
  createdById?: string | null;
};

export type PriceLineInput = {
  jobCode: string;
  description: string;
  unit: string;
  ratePerUnit: number; // cents
  category?: string | null;
  notes?: string | null;
};

export type VersionMeta = {
  label?: string | null;
  effectiveDate?: Date | null;
  expirationDate?: Date | null;
  notes?: string | null;
  createdById?: string | null;
};

// List all price books for a prime, newest first, with line + version counts.
export async function listPriceBooks(primeContractorId: string) {
  return prisma.priceBook.findMany({
    where: { primeContractorId },
    orderBy: [{ name: 'asc' }, { version: 'desc' }],
    include: {
      _count: { select: { lines: true, versions: true } },
      project: { select: { id: true, projectCode: true, projectName: true } },
    },
  });
}

// Resolve the "current" version of a book: the ACTIVE one, else the highest
// version number.
function pickCurrentVersion<T extends { status: string; version: number }>(versions: T[]): T | null {
  if (!versions.length) return null;
  const active = versions.find((v) => v.status === 'ACTIVE');
  if (active) return active;
  return [...versions].sort((a, b) => b.version - a.version)[0];
}

// Get a book with all its versions (each with lines). For backward compatibility
// the returned object also exposes `lines` and `version` reflecting the CURRENT
// version (active, else latest), which existing export/detail consumers rely on.
export async function getPriceBook(id: string) {
  const book = await prisma.priceBook.findUnique({
    where: { id },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        include: { lines: { orderBy: { jobCode: 'asc' } } },
      },
      primeContractor: { select: { id: true, companyName: true } },
      project: { select: { id: true, projectCode: true, projectName: true } },
    },
  });
  if (!book) return null;
  const current = pickCurrentVersion(book.versions);
  return {
    ...book,
    version: current?.version ?? book.version,
    currentVersionId: current?.id ?? null,
    lines: current?.lines ?? [],
  };
}

// Next version number for a book.
export async function nextBookVersionNumber(priceBookId: string): Promise<number> {
  const latest = await prisma.priceBookVersion.findFirst({
    where: { priceBookId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return (latest?.version ?? 0) + 1;
}

// Next book version number for a (prime, name) pair - used when a brand new named
// book is being created (mirrors the legacy PriceBook.version field).
export async function nextVersion(primeContractorId: string, name: string): Promise<number> {
  const latest = await prisma.priceBook.findFirst({
    where: { primeContractorId, name },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return (latest?.version ?? 0) + 1;
}

// Create a new DRAFT price book with its initial DRAFT version (v1). Lines, if
// supplied, are attached to that first version.
export async function createPriceBook(input: PriceBookInput, lines: PriceLineInput[] = []) {
  return prisma.$transaction(async (tx) => {
    const book = await tx.priceBook.create({
      data: {
        primeContractorId: input.primeContractorId,
        projectId: input.projectId ?? null,
        name: input.name,
        contract: input.contract ?? null,
        projectLabel: input.projectLabel ?? null,
        market: input.market ?? null,
        region: input.region ?? null,
        effectiveDate: input.effectiveDate ?? null,
        expirationDate: input.expirationDate ?? null,
        notes: input.notes ?? null,
        createdById: input.createdById ?? null,
        version: 1,
        status: 'DRAFT',
      },
    });
    const version = await tx.priceBookVersion.create({
      data: {
        priceBookId: book.id,
        version: 1,
        label: 'v1',
        effectiveDate: input.effectiveDate ?? null,
        expirationDate: input.expirationDate ?? null,
        notes: input.notes ?? null,
        createdById: input.createdById ?? null,
        status: 'DRAFT',
        lines: lines.length
          ? {
              create: lines.map((l) => ({
                priceBookId: book.id,
                jobCode: l.jobCode,
                description: l.description,
                unit: l.unit,
                ratePerUnit: l.ratePerUnit,
                category: l.category ?? null,
                notes: l.notes ?? null,
              })),
            }
          : undefined,
      },
    });
    return { ...book, currentVersionId: version.id };
  });
}

// Create a NEW immutable version of an existing book from an approved set of
// lines. Never mutates existing versions. Returns the new version with lines.
// Used by import approval and by manual "new version" actions.
export async function createPriceBookVersion(
  priceBookId: string,
  lines: PriceLineInput[],
  meta: VersionMeta = {},
) {
  return prisma.$transaction(async (tx) => {
    const book = await tx.priceBook.findUnique({ where: { id: priceBookId } });
    if (!book) throw new Error('Price book not found');
    const latest = await tx.priceBookVersion.findFirst({
      where: { priceBookId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const versionNumber = (latest?.version ?? 0) + 1;
    const version = await tx.priceBookVersion.create({
      data: {
        priceBookId,
        version: versionNumber,
        label: meta.label ?? `v${versionNumber}`,
        effectiveDate: meta.effectiveDate ?? null,
        expirationDate: meta.expirationDate ?? null,
        notes: meta.notes ?? null,
        createdById: meta.createdById ?? null,
        status: 'DRAFT',
        lines: lines.length
          ? {
              create: lines.map((l) => ({
                priceBookId,
                jobCode: l.jobCode,
                description: l.description,
                unit: l.unit,
                ratePerUnit: l.ratePerUnit,
                category: l.category ?? null,
                notes: l.notes ?? null,
              })),
            }
          : undefined,
      },
      include: { lines: true },
    });
    // Keep the book's mirrored version pointer at the newest version number so
    // detail/export views default to the latest.
    await tx.priceBook.update({ where: { id: priceBookId }, data: { version: versionNumber } });
    return version;
  });
}

// Activate a specific version. Archives any other ACTIVE version of the SAME
// book (exactly one active/current version per book) but never touches the lines
// of older versions - they remain intact for work orders pinned to them.
export async function activatePriceBookVersion(versionId: string) {
  const version = await prisma.priceBookVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new Error('Price book version not found');
  return prisma.$transaction(async (tx) => {
    await tx.priceBookVersion.updateMany({
      where: { priceBookId: version.priceBookId, status: 'ACTIVE', id: { not: versionId } },
      data: { status: 'ARCHIVED' },
    });
    const updated = await tx.priceBookVersion.update({
      where: { id: versionId },
      data: { status: 'ACTIVE' },
    });
    // Mirror active state + current version number onto the book row.
    await tx.priceBook.update({
      where: { id: version.priceBookId },
      data: { status: 'ACTIVE', version: version.version },
    });
    return updated;
  });
}

// Activate a book (backward-compatible entry point): activates the book's
// current (latest) version and archives other ACTIVE books of the same
// (prime, name) - legacy multi-row books created before the version model.
export async function activatePriceBook(id: string) {
  const book = await prisma.priceBook.findUnique({
    where: { id },
    include: { versions: { orderBy: { version: 'desc' } } },
  });
  if (!book) throw new Error('Price book not found');
  const current = pickCurrentVersion(book.versions);
  await prisma.priceBook.updateMany({
    where: { primeContractorId: book.primeContractorId, name: book.name, status: 'ACTIVE', id: { not: id } },
    data: { status: 'ARCHIVED' },
  });
  if (current) {
    await activatePriceBookVersion(current.id);
  } else {
    await prisma.priceBook.update({ where: { id }, data: { status: 'ACTIVE' } });
  }
  return prisma.priceBook.findUnique({ where: { id } }) as Promise<{ id: string; name: string; version: number }>;
}

export async function archivePriceBook(id: string) {
  return prisma.$transaction(async (tx) => {
    await tx.priceBookVersion.updateMany({
      where: { priceBookId: id, status: 'ACTIVE' },
      data: { status: 'ARCHIVED' },
    });
    return tx.priceBook.update({ where: { id }, data: { status: 'ARCHIVED' } });
  });
}

// Resolve the ACTIVE price book for a prime by name (or the single active book
// if name omitted), including the lines of its ACTIVE version.
export async function resolveActivePriceBook(primeContractorId: string, name?: string) {
  const book = await prisma.priceBook.findFirst({
    where: { primeContractorId, status: 'ACTIVE', ...(name ? { name } : {}) },
    orderBy: { version: 'desc' },
    include: {
      versions: { orderBy: { version: 'desc' }, include: { lines: true } },
    },
  });
  if (!book) return null;
  const current = pickCurrentVersion(book.versions);
  return { ...book, currentVersionId: current?.id ?? null, lines: current?.lines ?? [] };
}

// Resolve the currently-configured ACTIVE version of a specific book.
export async function resolveActiveVersion(priceBookId: string) {
  const active = await prisma.priceBookVersion.findFirst({
    where: { priceBookId, status: 'ACTIVE' },
    orderBy: { version: 'desc' },
    include: { lines: true },
  });
  if (active) return active;
  // Fall back to the latest version if none is explicitly ACTIVE.
  return prisma.priceBookVersion.findFirst({
    where: { priceBookId },
    orderBy: { version: 'desc' },
    include: { lines: true },
  });
}

// Clone an existing price book's current version lines into a new DRAFT book.
export async function clonePriceBook(
  sourceId: string,
  opts: { primeContractorId?: string; name?: string; projectId?: string | null; createdById?: string | null } = {},
) {
  const src = await getPriceBook(sourceId);
  if (!src) throw new Error('Source price book not found');
  const primeContractorId = opts.primeContractorId ?? src.primeContractorId;
  const name = opts.name ?? src.name;
  return createPriceBook(
    {
      primeContractorId,
      name,
      projectId: opts.projectId ?? null,
      contract: src.contract,
      projectLabel: src.projectLabel,
      market: src.market,
      region: src.region,
      effectiveDate: src.effectiveDate,
      expirationDate: src.expirationDate,
      notes: src.notes,
      createdById: opts.createdById ?? null,
    },
    src.lines.map((l) => ({
      jobCode: l.jobCode,
      description: l.description,
      unit: l.unit,
      ratePerUnit: l.ratePerUnit,
      category: l.category,
      notes: l.notes,
    })),
  );
}

// ---- Internal rate books (subcontractor + in-house) ---------------------------

export type SubRateInput = {
  workerId: string;
  jobCode: string;
  description?: string | null;
  unit?: string | null;
  ratePerUnit: number; // cents
  effectiveDate?: Date | null;
  expirationDate?: Date | null;
  notes?: string | null;
  createdById?: string | null;
};

export type InHouseRateInput = {
  jobCode: string;
  description?: string | null;
  unit?: string | null;
  ratePerUnit: number; // cents
  effectiveDate?: Date | null;
  expirationDate?: Date | null;
  notes?: string | null;
  createdById?: string | null;
};

// Add a NEW subcontractor rate version. We never overwrite an existing rate:
// the prior ACTIVE rate for the same (worker, jobCode) is archived, and a new
// versioned row is created. Existing jobs retain the rate they were costed at.
export async function addSubcontractorRate(input: SubRateInput) {
  return prisma.$transaction(async (tx) => {
    const prior = await tx.subcontractorRate.findFirst({
      where: { workerId: input.workerId, jobCode: input.jobCode, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
    if (prior) {
      await tx.subcontractorRate.update({ where: { id: prior.id }, data: { status: 'ARCHIVED' } });
    }
    return tx.subcontractorRate.create({
      data: {
        workerId: input.workerId,
        jobCode: input.jobCode,
        description: input.description ?? null,
        unit: input.unit ?? null,
        ratePerUnit: input.ratePerUnit,
        version: (prior?.version ?? 0) + 1,
        status: 'ACTIVE',
        effectiveDate: input.effectiveDate ?? null,
        expirationDate: input.expirationDate ?? null,
        notes: input.notes ?? null,
        createdById: input.createdById ?? null,
      },
    });
  });
}

export async function listSubcontractorRates(workerId?: string) {
  return prisma.subcontractorRate.findMany({
    where: { ...(workerId ? { workerId } : {}) },
    orderBy: [{ jobCode: 'asc' }, { version: 'desc' }],
    include: { worker: { select: { id: true, name: true, workerType: true } } },
  });
}

export async function addInHouseRate(input: InHouseRateInput) {
  return prisma.$transaction(async (tx) => {
    const prior = await tx.inHouseRate.findFirst({
      where: { jobCode: input.jobCode, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
    if (prior) {
      await tx.inHouseRate.update({ where: { id: prior.id }, data: { status: 'ARCHIVED' } });
    }
    return tx.inHouseRate.create({
      data: {
        jobCode: input.jobCode,
        description: input.description ?? null,
        unit: input.unit ?? null,
        ratePerUnit: input.ratePerUnit,
        version: (prior?.version ?? 0) + 1,
        status: 'ACTIVE',
        effectiveDate: input.effectiveDate ?? null,
        expirationDate: input.expirationDate ?? null,
        notes: input.notes ?? null,
        createdById: input.createdById ?? null,
      },
    });
  });
}

export async function listInHouseRates() {
  return prisma.inHouseRate.findMany({
    orderBy: [{ jobCode: 'asc' }, { version: 'desc' }],
  });
}

export type { Prisma };
