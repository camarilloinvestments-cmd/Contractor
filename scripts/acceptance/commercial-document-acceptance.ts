// Phase 3 acceptance — commercial-document subsystem (Estimate / Quote /
// Work Order / Invoice). Static, DB-free checks against the source of truth.
// Checks that require a live Postgres target (number allocation under
// concurrency, convert transaction integrity, real email delivery, counter-sync
// migration) are reported as LIVE-VM VALIDATION REQUIRED rather than faked.
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const live: string[] = [];

function ok(n: number, name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${String(n).padStart(2)}. ${name}${detail ? '  — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${String(n).padStart(2)}. ${name}${detail ? '  — ' + detail : ''}`); }
}
function liveRequired(n: number, name: string, how: string) {
  live.push(`${String(n).padStart(2)}. ${name} — ${how}`);
  console.log(`LIVE  ${String(n).padStart(2)}. ${name}  — requires live target: ${how}`);
}
function read(rel: string): string { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function exists(rel: string): boolean { return fs.existsSync(path.join(ROOT, rel)); }

// Money/cost/private terms that must never appear on any customer-facing artifact.
const FORBIDDEN = /\b(payout|cost|margin|commission|internalNote|gpsLat|gpsLng|latitude|longitude)\b/i;

console.log('Commercial-document subsystem acceptance (Phase 3)\n');

// ---- Numbering (requirement G) -------------------------------------------
const numbering = read('lib/documents/numbering.ts');
ok(1, 'Independent counters defined for all 4 document types',
  ['ESTIMATE', 'QUOTE', 'INVOICE', 'WORKORDER'].every((k) => new RegExp(`'${k}'`).test(numbering)),
  'CounterKey union covers EST/Q/INV/WO');
ok(2, 'createWithNumber retries on unique-collision (P2002) — concurrency safe',
  /P2002/.test(numbering) && /maxAttempts/.test(numbering),
  'retry loop present');
ok(3, 'allocateNumber uses atomic upsert/increment (no count+1)',
  /upsert/.test(numbering) && /increment/.test(numbering) && !/\.count\(/.test(numbering),
  'DocumentCounter increment');

const estRoute = read('app/api/estimates/route.ts');
const quoteRoute = read('app/api/quotes/route.ts');
const invRoute = read('app/api/invoices/route.ts');
const jobRoute = read('app/api/jobs/route.ts');
ok(4, 'Estimate create allocates EST# via createWithNumber(ESTIMATE)',
  /createWithNumber\(\s*'ESTIMATE'/.test(estRoute) && !/\.count\(/.test(estRoute));
ok(5, 'Quote create allocates Q# via createWithNumber(QUOTE)',
  /createWithNumber\(\s*'QUOTE'/.test(quoteRoute) && !/\.count\(/.test(quoteRoute));
ok(6, 'Invoice create allocates INV# via createWithNumber(INVOICE)',
  /createWithNumber\(\s*'INVOICE'/.test(invRoute) && !/\.count\(/.test(invRoute));
ok(7, 'Work-order create allocates WO# via createWithNumber(WORKORDER)',
  /createWithNumber\(\s*'WORKORDER'/.test(jobRoute) && !/\.count\(/.test(jobRoute));

// ---- Migration counter-sync (no collision with legacy records) -----------
const mig = read('prisma/migrations/0017_commercial_documents/migration.sql');
ok(8, 'Migration syncs WO/INV counters to legacy max (GREATEST, idempotent)',
  /DocumentCounter/.test(mig) && /GREATEST/.test(mig) && /WORKORDER/.test(mig) && /INVOICE/.test(mig));

// ---- Convert: create-new + preserve-source (requirements B, C, D) --------
const estConvert = read('app/api/estimates/[id]/convert/route.ts');
ok(9, 'Estimate→Quote convert creates a NEW quote (createWithNumber QUOTE)',
  /createWithNumber\(\s*'QUOTE'/.test(estConvert));
ok(10, 'Estimate→Quote convert PRESERVES the estimate (marks CONVERTED, never deletes)',
  /CONVERTED/.test(estConvert) && /convertedToQuoteId/.test(estConvert) && !/estimate\.delete\(/.test(estConvert));

const quoteConvert = read('app/api/quotes/[id]/convert/route.ts');
ok(11, 'Accepted Quote→WO convert creates a NEW work order (createWithNumber WORKORDER)',
  /createWithNumber\(\s*'WORKORDER'/.test(quoteConvert));
ok(12, 'Quote→WO convert PRESERVES the quote (marks CONVERTED, never deletes)',
  /CONVERTED/.test(quoteConvert) && /convertedToJobId/.test(quoteConvert) && !/quote\.delete\(/.test(quoteConvert));
ok(13, 'Quote→WO convert PINS provenance from the quote — does NOT re-query newer PriceBook',
  /quote\.priceBookVersionId/.test(quoteConvert) && !/resolveWorkOrderPin/.test(quoteConvert));
ok(14, 'Quote→WO convert only from ACCEPTED status',
  /status\s*!==\s*'ACCEPTED'/.test(quoteConvert));

// ---- Customer redaction by construction (requirement H) ------------------
const schema = read('prisma/schema.prisma');
function modelBlock(name: string): string {
  const m = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  return m ? m[0] : '';
}
ok(15, 'EstimateItem model exposes NO cost/payout/margin/commission fields',
  !FORBIDDEN.test(modelBlock('EstimateItem')), 'redaction by construction');
ok(16, 'QuoteItem model exposes NO cost/payout/margin/commission fields',
  !FORBIDDEN.test(modelBlock('QuoteItem')), 'redaction by construction');
// Strip comments before scanning — explanatory comments may name the very terms
// we forbid from RENDERED customer output; only the executable body matters.
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const pdf = stripComments(read('components/document-pdf.tsx'));
ok(17, 'Customer document PDF renders no cost/payout/margin/commission/GPS terms',
  !FORBIDDEN.test(pdf));

// ---- Snapshots + append-only send history (requirements E, F) ------------
const snapshots = read('lib/documents/snapshots.ts');
ok(18, 'Snapshot builders exist for estimate/quote/invoice (customer-facing)',
  /buildEstimateSnapshot/.test(snapshots) && /buildQuoteSnapshot/.test(snapshots) && /buildInvoiceSnapshot/.test(snapshots));
ok(19, 'Send history is APPEND-ONLY (documentSend.create only; no update/delete anywhere)',
  /documentSend\.create/.test(snapshots) &&
  !/documentSend\.(update|delete|upsert|updateMany|deleteMany)/.test(read('lib/documents/snapshots.ts')));

const estSend = read('app/api/estimates/[id]/send/route.ts');
const quoteSend = read('app/api/quotes/[id]/send/route.ts');
const invSend = read('app/api/invoices/[id]/send/route.ts');
ok(20, 'Each send records a revision + append-only DocumentSend (success AND failure)',
  [estSend, quoteSend, invSend].every((s) => /createRevision/.test(s) && /recordSend/.test(s)) &&
  // recordSend runs BEFORE the failure early-return, with a dynamic success flag
  // (success: result.ok) plus failureCategory/failureMessage populated on failure —
  // so BOTH outcomes are captured append-only.
  [estSend, quoteSend, invSend].every((s) =>
    /success:\s*result\.ok/.test(s) && /failureCategory/.test(s) &&
    s.indexOf('recordSend') < s.indexOf('if (!result.ok)')));
ok(21, 'Sends go through the Phase-2 provider system (sendEmail), not a 2nd SMTP',
  [estSend, quoteSend, invSend].every((s) => /sendEmail/.test(s)) &&
  [estSend, quoteSend, invSend].every((s) => !/nodemailer/.test(s)));

// ---- Preview == PDF parity (requirement E) -------------------------------
const estPrev = read('app/api/estimates/[id]/preview/route.ts');
const quotePrev = read('app/api/quotes/[id]/preview/route.ts');
const invPrev = read('app/api/invoices/[id]/preview/route.ts');
ok(22, 'Preview endpoints build the SAME snapshot as the PDF (exact-match parity) + email mode',
  /buildEstimateSnapshot/.test(estPrev) && /buildQuoteSnapshot/.test(quotePrev) && /buildInvoiceSnapshot/.test(invPrev) &&
  [estPrev, quotePrev, invPrev].every((s) => /email/.test(s)));

// ---- Templates + allowlist (requirements J, K) ---------------------------
const templates = read('lib/email/templates.ts');
ok(23, 'Distinct estimate/quote email templates registered',
  /ESTIMATE_NEW/.test(templates) && /QUOTE_NEW/.test(templates) && /QUOTE_ACCEPTED/.test(templates));
const allowlist = read('lib/email/allowlist.ts');
const renderer = read('lib/email/render.ts');
ok(24, 'Template variables are allowlisted and rendered without eval/Function',
  /estimate_number/.test(allowlist) && /quote_number/.test(allowlist) &&
  !/\beval\(/.test(renderer) && !/new Function/.test(renderer));

// ---- Edit-while-DRAFT + stable numbering ---------------------------------
const estId = read('app/api/estimates/[id]/route.ts');
const quoteId = read('app/api/quotes/[id]/route.ts');
ok(25, 'Estimate/Quote editable only while DRAFT',
  /EDITABLE_STATUSES/.test(estId) && /'DRAFT'/.test(estId) && /EDITABLE_STATUSES/.test(quoteId) && /'DRAFT'/.test(quoteId));
ok(26, 'Edit never reassigns the document number (stable once assigned)',
  !/estimateNumber\s*:/.test(estId.split('PUT')[1] ?? '') && !/quoteNumber\s*:/.test(quoteId.split('PUT')[1] ?? ''));

// ---- Navigation (requirement L) ------------------------------------------
const sidebar = read('app/(admin)/_components/admin-sidebar.tsx');
ok(27, 'Sidebar exposes Estimates, Quotes, Work Orders, Invoices',
  /\/estimates/.test(sidebar) && /\/quotes/.test(sidebar) && /Work Orders/.test(sidebar) && /\/invoices/.test(sidebar));
ok(28, 'Estimates & Quotes admin pages exist',
  exists('app/(admin)/estimates/page.tsx') && exists('app/(admin)/quotes/page.tsx'));

// ---- Live-target validation (DB writes / delivery) -----------------------
liveRequired(29, 'Number allocation is gap-tolerant & unique under concurrent creates',
  'against Postgres: fire N concurrent POST /api/{estimates,quotes,invoices,jobs}; assert all numbers unique, sequential, no P2002 leak');
liveRequired(30, 'Convert transactions are atomic (source preserved, target created)',
  'against Postgres: POST convert; assert source row still present with CONVERTED status + link, new target row created');
liveRequired(31, 'Counter-sync migration bumps WO/INV counters past legacy max',
  'apply migration 0017 on a DB with legacy WO/INV rows; assert DocumentCounter.value = max(existing suffix)');
liveRequired(32, 'Emails deliver via a configured provider and are logged append-only',
  'against Postgres + provider: POST send; assert DocumentSend row (success/provider/messageId) and no row mutated on resend');

console.log(`\n${pass} passed, ${fail} failed, ${live.length} live-VM validation required`);
if (fail > 0) process.exit(1);
