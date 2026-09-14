// Statement computation — pure, DB-free money math (integer cents throughout).
//
// A statement summarises a Prime (optionally a single Project) over a period:
//   opening balance  = outstanding as of periodStart
//   invoiced         = invoices ISSUED within the period
//   payments/credits = PAID payments RECEIVED within the period
//   ending balance   = opening + invoiced - payments
//   aging buckets    = outstanding invoices classified by days past due as of
//                      the statement date (Current / 1-30 / 31-60 / 61-90 / 91+)
//
// Everything here is customer-facing ONLY. No payout/cost/margin/commission or
// internal-note value is accepted or emitted (redaction by construction).

export type StmtInvoice = {
  id: string;
  invoiceNumber: string;
  total: number; // cents
  amountPaid: number; // cents
  createdAt: Date;
  dueDate?: Date | null;
};

export type StmtPayment = {
  id: string;
  amount: number; // cents
  createdAt: Date;
  reference?: string | null;
  invoiceNumber?: string | null;
};

export type StatementLineData = {
  lineType: 'OPENING' | 'INVOICE' | 'PAYMENT';
  refId: string | null;
  refNumber: string | null;
  date: Date;
  description: string;
  charges: number; // cents
  credits: number; // cents
  balance: number; // cents; running balance after this row
  sortOrder: number;
};

export type StatementComputation = {
  openingBalance: number;
  invoicedAmount: number;
  paymentsAmount: number;
  endingBalance: number;
  agingCurrent: number;
  aging1To30: number;
  aging31To60: number;
  aging61To90: number;
  aging91Plus: number;
  lines: StatementLineData[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

export type ComputeStatementInput = {
  statementDate: Date;
  periodStart: Date;
  periodEnd: Date;
  invoices: StmtInvoice[];
  payments: StmtPayment[];
};

export function computeStatement(input: ComputeStatementInput): StatementComputation {
  const { statementDate, periodStart, periodEnd, invoices, payments } = input;

  // --- Opening balance: everything that happened strictly before periodStart.
  const openingInvoiced = invoices
    .filter((i) => i.createdAt < periodStart)
    .reduce((s, i) => s + (i.total || 0), 0);
  const openingPaid = payments
    .filter((p) => p.createdAt < periodStart)
    .reduce((s, p) => s + (p.amount || 0), 0);
  const openingBalance = openingInvoiced - openingPaid;

  // --- In-period activity.
  const periodInvoices = invoices.filter(
    (i) => i.createdAt >= periodStart && i.createdAt <= periodEnd
  );
  const periodPayments = payments.filter(
    (p) => p.createdAt >= periodStart && p.createdAt <= periodEnd
  );
  const invoicedAmount = periodInvoices.reduce((s, i) => s + (i.total || 0), 0);
  const paymentsAmount = periodPayments.reduce((s, p) => s + (p.amount || 0), 0);
  const endingBalance = openingBalance + invoicedAmount - paymentsAmount;

  // --- Ledger lines (chronological), running balance from opening.
  const activity: StatementLineData[] = [
    ...periodInvoices.map((i) => ({
      lineType: 'INVOICE' as const,
      refId: i.id,
      refNumber: i.invoiceNumber,
      date: i.createdAt,
      description: `Invoice ${i.invoiceNumber}`,
      charges: i.total || 0,
      credits: 0,
      balance: 0,
      sortOrder: 0,
    })),
    ...periodPayments.map((p) => ({
      lineType: 'PAYMENT' as const,
      refId: p.id,
      refNumber: p.reference ?? p.invoiceNumber ?? null,
      date: p.createdAt,
      description: p.invoiceNumber
        ? `Payment received — Invoice ${p.invoiceNumber}`
        : 'Payment received',
      charges: 0,
      credits: p.amount || 0,
      balance: 0,
      sortOrder: 0,
    })),
  ];
  activity.sort((a, b) => a.date.getTime() - b.date.getTime());

  let running = openingBalance;
  const lines: StatementLineData[] = [
    {
      lineType: 'OPENING',
      refId: null,
      refNumber: null,
      date: periodStart,
      description: 'Opening balance',
      charges: 0,
      credits: 0,
      balance: openingBalance,
      sortOrder: 0,
    },
  ];
  activity.forEach((row, idx) => {
    running = running + (row.charges || 0) - (row.credits || 0);
    lines.push({ ...row, balance: running, sortOrder: idx + 1 });
  });

  // --- Aging: outstanding invoices as of the statement date, by days past due.
  let agingCurrent = 0;
  let aging1To30 = 0;
  let aging31To60 = 0;
  let aging61To90 = 0;
  let aging91Plus = 0;
  for (const i of invoices) {
    if (i.createdAt > statementDate) continue; // not yet issued as of the statement
    const outstanding = (i.total || 0) - (i.amountPaid || 0);
    if (outstanding <= 0) continue;
    const dueRef = i.dueDate ?? i.createdAt;
    const past = daysBetween(dueRef, statementDate);
    if (past <= 0) agingCurrent += outstanding;
    else if (past <= 30) aging1To30 += outstanding;
    else if (past <= 60) aging31To60 += outstanding;
    else if (past <= 90) aging61To90 += outstanding;
    else aging91Plus += outstanding;
  }

  return {
    openingBalance,
    invoicedAmount,
    paymentsAmount,
    endingBalance,
    agingCurrent,
    aging1To30,
    aging31To60,
    aging61To90,
    aging91Plus,
    lines,
  };
}
