// Live-defect acceptance — Statements math + Worker-card visibility + Billing
// sidebar grouping. Three remediation defects that previously lacked a harness:
//   A) Statements module: computeStatement money math (functional, DB-free).
//   B) Invisible Worker cards: reveal animation can never leave data hidden, and
//      the workers list has explicit loading / error / empty states.
//   C) Billing sidebar grouping: Statements lives under a Billing nav group.
//
// Run:  node_modules/.bin/tsx scripts/acceptance/remediation-ui-acceptance.ts
// Exit: non-zero if any check FAILS.
import fs from 'fs';
import path from 'path';
import { computeStatement, type ComputeStatementInput } from '../../lib/documents/statements';

let pass = 0, fail = 0;
function ok(n: number, name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${String(n).padStart(2)}. ${name}${detail ? '  \u2014 ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${String(n).padStart(2)}. ${name}${detail ? '  \u2014 ' + detail : ''}`); }
}
const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const D = (s: string) => new Date(s + 'T12:00:00Z');

console.log('=== Remediation UI Acceptance (Statements / Workers / Billing nav) ===');

// --- A) Statements: functional money math (integer cents) ------------------
{
  const input: ComputeStatementInput = {
    statementDate: D('2026-03-31'),
    periodStart: D('2026-03-01'),
    periodEnd: D('2026-03-31'),
    invoices: [
      { id: 'i1', invoiceNumber: 'INV-1', total: 100000, amountPaid: 100000, createdAt: D('2026-01-15'), dueDate: D('2026-02-15') },
      { id: 'i2', invoiceNumber: 'INV-2', total: 50000, amountPaid: 0, createdAt: D('2026-03-10'), dueDate: D('2026-03-20') },
      { id: 'i3', invoiceNumber: 'INV-3', total: 30000, amountPaid: 30000, createdAt: D('2026-03-25'), dueDate: D('2026-04-10') },
    ],
    payments: [
      { id: 'p1', amount: 100000, createdAt: D('2026-01-20'), reference: 'ACH-1' },
      { id: 'p2', amount: 30000, createdAt: D('2026-03-26'), invoiceNumber: 'INV-3' },
    ],
  };
  const r = computeStatement(input);
  ok(1, 'Opening balance nets pre-period invoices vs payments', r.openingBalance === 0, `openingBalance=${r.openingBalance}`);
  ok(2, 'Invoiced amount sums only in-period invoices', r.invoicedAmount === 80000, `invoicedAmount=${r.invoicedAmount}`);
  ok(3, 'Payments amount sums only in-period payments', r.paymentsAmount === 30000, `paymentsAmount=${r.paymentsAmount}`);
  ok(4, 'Ending balance = opening + invoiced - payments', r.endingBalance === 50000, `endingBalance=${r.endingBalance}`);
  ok(5, 'Aging: overdue in-period invoice lands in 1-30 bucket', r.aging1To30 === 50000 && r.agingCurrent === 0, `1To30=${r.aging1To30} current=${r.agingCurrent}`);
  ok(6, 'Fully-paid invoices contribute no aging', r.aging31To60 === 0 && r.aging61To90 === 0 && r.aging91Plus === 0);
  ok(7, 'Ledger begins with an OPENING line then chronological activity', r.lines.length === 4 && r.lines[0].lineType === 'OPENING' && r.lines[0].balance === 0);
  ok(8, 'Running balance is correct on the final ledger row', r.lines[r.lines.length - 1].balance === 50000, `final=${r.lines[r.lines.length - 1].balance}`);
  const order = r.lines.slice(1).map((l) => l.lineType).join(',');
  ok(9, 'Activity ordered INVOICE,INVOICE,PAYMENT by date', order === 'INVOICE,INVOICE,PAYMENT', order);
  // Current-bucket path: an invoice not yet past due as of statement date.
  const r2 = computeStatement({
    statementDate: D('2026-03-15'), periodStart: D('2026-03-01'), periodEnd: D('2026-03-31'),
    invoices: [{ id: 'x', invoiceNumber: 'INV-X', total: 20000, amountPaid: 0, createdAt: D('2026-03-10'), dueDate: D('2026-03-25') }],
    payments: [],
  });
  ok(10, 'Not-yet-due outstanding invoice lands in Current bucket', r2.agingCurrent === 20000 && r2.aging1To30 === 0, `current=${r2.agingCurrent}`);
}

// --- B) Worker card visibility + reveal animation --------------------------
{
  const anim = read('components/ui/animate.tsx');
  // Match the actual prop usage (`whileInView={`), not the comment that names it.
  ok(11, 'Reveal animates ON MOUNT (animate=), never on scroll (no whileInView prop)',
     /animate=\{\{/.test(anim) && !/whileInView=\{/.test(anim));
  ok(12, 'Respects reduced-motion so opacity:0 is never a resting state',
     /useReducedMotion/.test(anim));
  ok(13, 'Comment documents the invariant: decoration can never hide content',
     /it can never hide it/.test(anim));

  const workers = read('app/(admin)/workers/_components/workers-content.tsx');
  ok(14, 'Workers list has an explicit loading state', /const \[loading, setLoading\] = useState\(true\)/.test(workers) && /loading \?/.test(workers));
  ok(15, 'Workers list has an explicit error state (fetch failure is visible)',
     /const \[error, setError\] = useState<string \| null>\(null\)/.test(workers) && /: error \?/.test(workers));
  ok(16, 'Workers list has explicit empty + no-match states', /No workers yet/.test(workers) && /No workers match/.test(workers));
}

// --- C) Billing sidebar grouping -------------------------------------------
{
  const sidebar = read('app/(admin)/_components/admin-sidebar.tsx');
  const billingIdx = sidebar.indexOf("label: 'Billing'");
  ok(17, 'Sidebar defines a Billing nav group', billingIdx > -1);
  // Statements item present and inside the Billing group block (before the next group label).
  // The Billing group's block runs until the next GROUP label ('Financials').
  const afterBilling = sidebar.slice(billingIdx);
  const nextGroupIdx = afterBilling.indexOf("label: 'Financials'");
  const billingBlock = afterBilling.slice(0, nextGroupIdx > -1 ? nextGroupIdx : undefined);
  ok(18, 'Statements item nested under the Billing group', /href: '\/statements', label: 'Statements'/.test(billingBlock));
  ok(19, 'Billing group also contains Estimates / Quotes / Invoices', /Estimates/.test(billingBlock) && /Quotes/.test(billingBlock) && /Invoices/.test(billingBlock));
}

console.log(`\n=== Remediation UI Acceptance: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
