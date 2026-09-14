export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { resolveWorkOrderPin } from '@/lib/work-orders';
import { writeAudit, requestMeta } from '@/lib/audit';

function canManage(role?: string | null) {
  return role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const primeContractorId = searchParams.get('primeContractorId');
  const projectId = searchParams.get('projectId');

  const where: any = {};
  if (status) where.status = status;
  if (primeContractorId) where.primeContractorId = primeContractorId;
  if (projectId) where.projectId = projectId;

  // Sec D: FIELD_WORKERs may only list work orders they are assigned to; they
  // must never be able to enumerate the entire job table.
  if (session.user.role === 'FIELD_WORKER') {
    where.tasks = { some: { workerId: session.user.id } };
  }

  const jobs = await prisma.job.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: {
      primeContractor: { select: { companyName: true } },
      project: { select: { id: true, projectCode: true, projectName: true } },
      _count: { select: { tasks: true } },
    },
  });
  return NextResponse.json(jobs);
}

// Create a Work Order (Job). Option A flow: a real Project is REQUIRED; the
// price book + version are resolved from the project's configured default (or an
// authorized override) and PINNED onto the work order. Arbitrary free-text
// "project" strings are rejected. Only privileged roles may create work orders.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || !canManage(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (typeof body?.project === 'string') {
      return NextResponse.json(
        { error: 'Free-text project is not allowed; select a real Project (projectId)' },
        { status: 400 },
      );
    }
    if (!body?.projectId) {
      return NextResponse.json({ error: 'projectId is required to create a work order' }, { status: 400 });
    }
    if (!body?.jobName) {
      return NextResponse.json({ error: 'jobName is required' }, { status: 400 });
    }

    // Resolve + pin the exact (prime, project, book, version).
    const pin = await resolveWorkOrderPin({
      projectId: body.projectId,
      overrideVersionId: body.priceBookVersionId ?? body.overrideVersionId ?? null,
    });

    const count = await prisma.job.count();
    const jobNumber = `WO-${String(count + 1).padStart(5, '0')}`;

    // Explicit allow-list (no mass assignment): only these client fields are
    // honored; pin + jobNumber are server-controlled.
    const job = await prisma.job.create({
      data: {
        jobNumber,
        jobName: body.jobName,
        primeContractorId: pin.primeContractorId,
        projectId: pin.projectId,
        priceBookId: pin.priceBookId,
        priceBookVersionId: pin.priceBookVersionId,
        address: body.address ?? null,
        city: body.city ?? null,
        state: body.state ?? null,
        zip: body.zip ?? null,
        latitude: typeof body.latitude === 'number' ? body.latitude : null,
        longitude: typeof body.longitude === 'number' ? body.longitude : null,
        startDate: body.startDate ? new Date(body.startDate) : null,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        status: body.status ?? 'DRAFT',
        notes: body.notes ?? null,
        otherDirectCosts: typeof body.otherDirectCosts === 'number' ? body.otherDirectCosts : 0,
        salespersonId: body.salespersonId ?? null,
        commissionPlanId: body.commissionPlanId ?? null,
        geofenceRadiusFeet: typeof body.geofenceRadiusFeet === 'number' ? body.geofenceRadiusFeet : null,
      },
    });
    await writeAudit({
      actor: { id: session.user.id, email: session.user.email, role: session.user.role },
      action: 'work_order.create', entityType: 'Job', entityId: job.id,
      metadata: {
        jobNumber: job.jobNumber, projectId: pin.projectId,
        priceBookId: pin.priceBookId, priceBookVersionId: pin.priceBookVersionId,
      },
      ...requestMeta(request),
    });
    return NextResponse.json(job);
  } catch (err: any) {
    console.error('Create job error:', err?.message);
    return NextResponse.json({ error: err?.message || 'Failed to create job' }, { status: 400 });
  }
}
