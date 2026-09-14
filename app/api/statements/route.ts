export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManage } from '@/lib/rbac';
import { writeAudit, requestMeta } from '@/lib/audit';
import { createWithNumber } from '@/lib/documents/numbering';
import { computeStatement, type StmtInvoice, type StmtPayment } from '@/lib/documents/statements';
import { buildStatementSnapshot, createRevision } from '@/lib/documents/snapshots';

// GET /api/statements — list statements (managers/admins).
export async function GET() {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const statements = await prisma.statement.findMany({
    include: {
      primeContractor: { select: { id: true, companyName: true, contactName: true } },
      project: { select: { id: true, projectName: true, projectCode: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ statements });
}

// POST /api/statements — generate a new statement for a prime (optionally scoped
// to a single project) over a period. Snapshots invoices + PAID payments and
// computes opening/ending balances and aging. Customer-facing money only.
export async function POST(req: Request) {
  const gate = await requireManage();
  if ('res' in gate) return gate.res;
  const { user } = gate;

  try {
    const body = await req.json().catch(() => ({}));
    const primeContractorId = body?.primeContractorId as string | undefined;
    if (!primeContractorId) {
      return NextResponse.json({ error: 'primeContractorId is required' }, { status: 400 });
    }
    const prime = await prisma.primeContractor.findUnique({ where: { id: primeContractorId } });
    if (!prime) return NextResponse.json({ error: 'Prime contractor not found' }, { status: 404 });

    const projectId = (body?.projectId as string) || null;
    if (projectId) {
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const now = new Date();
    const statementDate = body?.statementDate ? new Date(body.statementDate) : now;
    // Default period: the calendar month containing the statement date.
    const periodStart = body?.periodStart
      ? new Date(body.periodStart)
      : new Date(statementDate.getFullYear(), statementDate.getMonth(), 1);
    const periodEnd = body?.periodEnd
      ? new Date(body.periodEnd)
      : new Date(statementDate.getFullYear(), statementDate.getMonth() + 1, 0, 23, 59, 59, 999);

    // Invoices for this prime. When scoped to a project, narrow to invoices whose
    // line items belong to jobs on that project.
    const invoiceWhere: any = { primeContractorId };
    if (projectId) {
      invoiceWhere.items = { some: { job: { projectId } } };
    }
    const invoices = await prisma.invoice.findMany({
      where: invoiceWhere,
      select: {
        id: true,
        invoiceNumber: true,
        total: true,
        amountPaid: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const invoiceIds = invoices.map((i) => i.id);
    // PAID payments count as credits. Scope to the filtered invoice set when a
    // project is selected; otherwise all PAID payments for the prime.
    const paymentWhere: any = { status: 'PAID' };
    if (projectId) {
      paymentWhere.invoiceId = { in: invoiceIds.length ? invoiceIds : ['__none__'] };
    } else {
      paymentWhere.OR = [
        { primeContractorId },
        { invoiceId: { in: invoiceIds.length ? invoiceIds : ['__none__'] } },
      ];
    }
    const payments = await prisma.payment.findMany({
      where: paymentWhere,
      select: {
        id: true,
        amount: true,
        createdAt: true,
        providerReferenceId: true,
        invoice: { select: { invoiceNumber: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const stmtInvoices: StmtInvoice[] = invoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      total: i.total,
      amountPaid: i.amountPaid,
      createdAt: i.createdAt,
      dueDate: null,
    }));
    const stmtPayments: StmtPayment[] = payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      createdAt: p.createdAt,
      reference: p.providerReferenceId ?? null,
      invoiceNumber: p.invoice?.invoiceNumber ?? null,
    }));

    const comp = computeStatement({
      statementDate,
      periodStart,
      periodEnd,
      invoices: stmtInvoices,
      payments: stmtPayments,
    });

    const statement = await createWithNumber('STATEMENT', (statementNumber) =>
      prisma.statement.create({
        data: {
          statementNumber,
          primeContractorId,
          projectId,
          status: 'DRAFT',
          statementDate,
          periodStart,
          periodEnd,
          openingBalance: comp.openingBalance,
          invoicedAmount: comp.invoicedAmount,
          paymentsAmount: comp.paymentsAmount,
          endingBalance: comp.endingBalance,
          agingCurrent: comp.agingCurrent,
          aging1To30: comp.aging1To30,
          aging31To60: comp.aging31To60,
          aging61To90: comp.aging61To90,
          aging91Plus: comp.aging91Plus,
          notes: body?.notes || null,
          createdById: user.id,
          lines: {
            create: comp.lines.map((l) => ({
              lineType: l.lineType,
              refId: l.refId,
              refNumber: l.refNumber,
              date: l.date,
              description: l.description,
              charges: l.charges,
              credits: l.credits,
              balance: l.balance,
              sortOrder: l.sortOrder,
            })),
          },
        },
        include: {
          primeContractor: true,
          project: true,
          lines: { orderBy: { sortOrder: 'asc' } },
        },
      })
    );

    // Capture the initial immutable revision (parity with other doc types).
    const snapshot = buildStatementSnapshot(statement);
    const revision = await createRevision('STATEMENT', statement.id, snapshot, user.id);
    await prisma.statement.update({
      where: { id: statement.id },
      data: { currentRevision: revision.revision },
    });

    await writeAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: 'statement.create',
      entityType: 'Statement',
      entityId: statement.id,
      metadata: {
        statementNumber: statement.statementNumber,
        endingBalance: statement.endingBalance,
      },
      ...requestMeta(req),
    });

    return NextResponse.json({ statement }, { status: 201 });
  } catch (err: any) {
    console.error('Statement create error:', err?.message);
    return NextResponse.json({ error: 'Failed to create statement' }, { status: 500 });
  }
}
