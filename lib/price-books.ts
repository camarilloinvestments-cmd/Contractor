// Workstream G/J: prime-contractor price books (versioned) and internal rate
// books (subcontractor + in-house). A Price Book records what the PRIME pays US
// per job code. Rate books record what WE PAY subcontractors and our own crews.
// These are kept strictly separate: a price book is client-facing (safe to
// export to a prime); rate books are internal-only and must NEVER be mixed into
// prime exports.
//
// Versioning rules:
//  - Creating a new book with the same (prime, name) increments the version.
//  - Activating a book archives any previously-ACTIVE book of the same name.
//  - Existing jobs keep the rates that applied at their time (we never rewrite
//    historical lines; a new version is a new row set).
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export type PriceBookInput = {
  primeContractorId: string;
  name: string;
  contract?: string | null;
  project?: string | null;
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

// List all price books for a prime, newest first, with line counts.
export async function listPriceBooks(primeContractorId: string) {
  return prisma.priceBook.findMany({
    where: { primeContractorId },
    orderBy: [{ name: 'asc' }, { version: 'desc' }],
    include: { _count: { select: { lines: true } } },
  });
}

export async function getPriceBook(id: string) {
  return prisma.priceBook.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { jobCode: 'asc' } },
      primeContractor: { select: { id: true, companyName: true } },
    },
  });
}

// Next version number for a (prime, name) pair.
export async function nextVersion(primeContractorId: string, name: string): Promise<number> {
  const latest = await prisma.priceBook.findFirst({
    where: { primeContractorId, name },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return (latest?.version ?? 0) + 1;
}

// Create a new DRAFT price book (optionally seeded with lines).
export async function createPriceBook(input: PriceBookInput, lines: PriceLineInput[] = []) {
  const version = await nextVersion(input.primeContractorId, input.name);
  return prisma.priceBook.create({
    data: {
      primeContractorId: input.primeContractorId,
      name: input.name,
      contract: input.contract ?? null,
      project: input.project ?? null,
      market: input.market ?? null,
      region: input.region ?? null,
      effectiveDate: input.effectiveDate ?? null,
      expirationDate: input.expirationDate ?? null,
      notes: input.notes ?? null,
      createdById: input.createdById ?? null,
      version,
      status: 'DRAFT',
      lines: lines.length
        ? {
            create: lines.map((l) => ({
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
    include: { _count: { select: { lines: true } } },
  });
}

// Activate a book. Any other ACTIVE book with the same (prime, name) is archived
// so exactly one version is active per named book.
export async function activatePriceBook(id: string) {
  const book = await prisma.priceBook.findUnique({ where: { id } });
  if (!book) throw new Error('Price book not found');
  return prisma.$transaction(async (tx) => {
    await tx.priceBook.updateMany({
      where: {
        primeContractorId: book.primeContractorId,
        name: book.name,
        status: 'ACTIVE',
        id: { not: id },
      },
      data: { status: 'ARCHIVED' },
    });
    return tx.priceBook.update({ where: { id }, data: { status: 'ACTIVE' } });
  });
}

export async function archivePriceBook(id: string) {
  return prisma.priceBook.update({ where: { id }, data: { status: 'ARCHIVED' } });
}

// Resolve the ACTIVE price book for a prime by name (or the single active book
// if name omitted). Used at job creation to pin rates.
export async function resolveActivePriceBook(primeContractorId: string, name?: string) {
  return prisma.priceBook.findFirst({
    where: {
      primeContractorId,
      status: 'ACTIVE',
      ...(name ? { name } : {}),
    },
    orderBy: { version: 'desc' },
    include: { lines: true },
  });
}

// Clone an existing price book (all lines) into a new DRAFT version. Optionally
// retarget to a different prime and/or rename (used to reuse a book across
// primes without touching core code).
export async function clonePriceBook(
  sourceId: string,
  opts: { primeContractorId?: string; name?: string; createdById?: string | null } = {},
) {
  const src = await prisma.priceBook.findUnique({ where: { id: sourceId }, include: { lines: true } });
  if (!src) throw new Error('Source price book not found');
  const primeContractorId = opts.primeContractorId ?? src.primeContractorId;
  const name = opts.name ?? src.name;
  return createPriceBook(
    {
      primeContractorId,
      name,
      contract: src.contract,
      project: src.project,
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

// Replace all lines of a DRAFT book with an approved set (used by import
// approval). Only DRAFT books can be bulk-replaced.
export async function replaceLines(priceBookId: string, lines: PriceLineInput[]) {
  return prisma.$transaction(async (tx) => {
    await tx.priceLine.deleteMany({ where: { priceBookId } });
    if (lines.length) {
      await tx.priceLine.createMany({
        data: lines.map((l) => ({
          priceBookId,
          jobCode: l.jobCode,
          description: l.description,
          unit: l.unit,
          ratePerUnit: l.ratePerUnit,
          category: l.category ?? null,
          notes: l.notes ?? null,
        })),
      });
    }
    return tx.priceBook.update({
      where: { id: priceBookId },
      data: { updatedAt: new Date() },
      include: { _count: { select: { lines: true } } },
    });
  });
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
