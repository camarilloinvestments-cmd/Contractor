// Option A: first-class Project entity. A Project belongs to exactly one Prime
// Contractor and is unique WITHIN that prime (not globally): Comcast/FL-ARCADIA
// and another prime's FL-ARCADIA are different projects. A Project carries the
// default Prime Price Book and the default (configured) version used when
// creating a Work Order for that project.
import { prisma } from '@/lib/prisma';
import { resolveActiveVersion } from '@/lib/price-books';

export type ProjectInput = {
  primeContractorId: string;
  projectCode: string;
  projectName?: string | null;
  description?: string | null;
  status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  defaultPriceBookId?: string | null;
  defaultPriceBookVersionId?: string | null;
  createdById?: string | null;
};

export async function listProjects(primeContractorId?: string) {
  return prisma.project.findMany({
    where: { ...(primeContractorId ? { primeContractorId } : {}) },
    orderBy: [{ primeContractorId: 'asc' }, { projectCode: 'asc' }],
    include: {
      primeContractor: { select: { id: true, companyName: true } },
      defaultPriceBook: { select: { id: true, name: true } },
      defaultPriceBookVersion: { select: { id: true, version: true, label: true, status: true } },
      _count: { select: { jobs: true, priceBooks: true } },
    },
  });
}

export async function getProject(id: string) {
  return prisma.project.findUnique({
    where: { id },
    include: {
      primeContractor: { select: { id: true, companyName: true } },
      defaultPriceBook: { select: { id: true, name: true, status: true } },
      defaultPriceBookVersion: {
        select: { id: true, version: true, label: true, status: true, effectiveDate: true },
      },
      priceBooks: { select: { id: true, name: true, status: true, version: true } },
    },
  });
}

// Create a project scoped to a prime. Uniqueness on (primeContractorId,
// projectCode) is enforced by the database; we surface a clean error.
export async function createProject(input: ProjectInput) {
  const existing = await prisma.project.findFirst({
    where: { primeContractorId: input.primeContractorId, projectCode: input.projectCode },
    select: { id: true },
  });
  if (existing) {
    throw new Error(`Project code "${input.projectCode}" already exists for this prime contractor`);
  }
  return prisma.project.create({
    data: {
      primeContractorId: input.primeContractorId,
      projectCode: input.projectCode,
      projectName: input.projectName ?? null,
      description: input.description ?? null,
      status: input.status ?? 'ACTIVE',
      defaultPriceBookId: input.defaultPriceBookId ?? null,
      defaultPriceBookVersionId: input.defaultPriceBookVersionId ?? null,
      createdById: input.createdById ?? null,
    },
  });
}

export async function updateProject(id: string, patch: Partial<ProjectInput>) {
  const data: Record<string, unknown> = {};
  for (const k of ['projectName', 'description', 'status', 'defaultPriceBookId', 'defaultPriceBookVersionId'] as const) {
    if (k in patch) data[k] = (patch as Record<string, unknown>)[k];
  }
  // projectCode changes must remain unique within the prime.
  if (patch.projectCode) {
    const proj = await prisma.project.findUnique({ where: { id }, select: { primeContractorId: true } });
    if (proj) {
      const clash = await prisma.project.findFirst({
        where: { primeContractorId: proj.primeContractorId, projectCode: patch.projectCode, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw new Error(`Project code "${patch.projectCode}" already exists for this prime contractor`);
    }
    data.projectCode = patch.projectCode;
  }
  return prisma.project.update({ where: { id }, data });
}

// Set a project's default price book and (optionally) default version. If a book
// is provided without a version, we resolve the book's currently-active version.
export async function setProjectDefaults(
  id: string,
  opts: { defaultPriceBookId?: string | null; defaultPriceBookVersionId?: string | null },
) {
  let versionId = opts.defaultPriceBookVersionId ?? null;
  if (opts.defaultPriceBookId && !versionId) {
    const v = await resolveActiveVersion(opts.defaultPriceBookId);
    versionId = v?.id ?? null;
  }
  return prisma.project.update({
    where: { id },
    data: {
      defaultPriceBookId: opts.defaultPriceBookId ?? null,
      defaultPriceBookVersionId: versionId,
    },
  });
}

// Resolve the version a NEW work order should pin for a project: the project's
// explicitly configured default version if set, otherwise the active version of
// the project's default book. Returns null if the project has no default book.
export async function resolveProjectDefaultVersion(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      defaultPriceBookVersion: { include: { lines: true } },
      defaultPriceBook: true,
    },
  });
  if (!project) return null;
  if (project.defaultPriceBookVersion) {
    return {
      priceBookId: project.defaultPriceBookVersion.priceBookId,
      version: project.defaultPriceBookVersion,
    };
  }
  if (project.defaultPriceBookId) {
    const v = await resolveActiveVersion(project.defaultPriceBookId);
    if (v) return { priceBookId: project.defaultPriceBookId, version: v };
  }
  return null;
}
