// Ruling #5 — Commercial Email Template Cleanup Acceptance Harness.
//
// DB-free proof that optional fields (project, expiration date) never produce
// awkward text such as "for project ." or "This estimate is valid until .", and
// that no blank labels / dangling punctuation / "null" / "undefined" artifacts
// are emitted. Exercises the REAL code paths: lib/email/render.ts conditional
// renderer + lib/email/variables.ts variable builders + the shipped
// DEFAULT_TEMPLATES for estimate / quote / invoice / statement.
//
// Run:  node_modules/.bin/tsx scripts/acceptance/email-conditional-acceptance.ts
// Exit: non-zero if any check FAILS.
import { renderTemplate } from '../../lib/email/render';
import { getDefaultTemplate, TEMPLATE_KEYS } from '../../lib/email/templates';
import {
  companyVariables,
  estimateVariables,
  quoteVariables,
  invoiceVariables,
  statementVariables,
  mergeVariables,
} from '../../lib/email/variables';
import type { CompanyBranding } from '../../lib/branding';

let pass = 0;
let fail = 0;
function ok(n: number, name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${String(n).padStart(2)}. ${name}${detail ? '  \u2014 ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${String(n).padStart(2)}. ${name}${detail ? '  \u2014 ' + detail : ''}`); }
}

const BRAND: CompanyBranding = {
  companyName: 'Camarillo Fiber LLC',
  logoUrl: null,
  logoStoragePath: null,
  logoContentType: null,
  address: '100 Main St',
  city: 'Arcadia',
  state: 'FL',
  zip: '34266',
  phone: '555-0100',
  email: 'billing@camarillofiber.com',
  website: 'camarillofiber.com',
  primaryColor: '#0b5cad',
} as CompanyBranding;

const company = companyVariables(BRAND);

// Detects the artifacts ruling #5 forbids in a rendered body.
function hasArtifacts(text: string): string[] {
  const problems: string[] = [];
  if (/for project\s*[.,]/i.test(text)) problems.push('dangling "for project ."');
  if (/valid until\s*[.,]/i.test(text)) problems.push('dangling "valid until ."');
  if (/next steps\s+for project\s*[.,]/i.test(text)) problems.push('dangling "for project ."');
  if (/\bnull\b/.test(text)) problems.push('literal "null"');
  if (/\bundefined\b/.test(text)) problems.push('literal "undefined"');
  if (/\{\{|\}\}/.test(text)) problems.push('unresolved token braces');
  if (/\s[.,;:]/.test(text)) problems.push('space before punctuation');
  if (/[ \t]{2,}/.test(text)) problems.push('double space');
  return problems;
}

// ---- 1. Renderer unit behavior: {{#if}} drops block when var empty --------
const tpl = 'A{{#if project_name}} for project {{project_name}}{{/if}}.';
ok(1, 'if-block omitted when variable empty', renderTemplate(tpl, { ...company }) === 'A.', renderTemplate(tpl, { ...company }));
ok(2, 'if-block kept when variable present', renderTemplate(tpl, { project_name: 'Ph1' }) === 'A for project Ph1.', renderTemplate(tpl, { project_name: 'Ph1' }));
ok(3, 'whitespace-only variable treated as empty', renderTemplate(tpl, { project_name: '   ' }) === 'A.');
ok(4, 'sequential if-blocks bind independently',
  renderTemplate('{{#if project_name}}P{{/if}}{{#if expiration_date}}E{{/if}}X', { expiration_date: 'z' }) === 'EX');

// ---- 2. Estimate email, Project + Expiration BOTH null --------------------
{
  const t = getDefaultTemplate(TEMPLATE_KEYS.ESTIMATE_NEW)!;
  const vars = mergeVariables(company, estimateVariables({
    estimateNumber: 'EST-00001',
    issueDate: new Date('2026-09-14T00:00:00Z'),
    expirationDate: null,
    total: 500000,
    primeContractor: { companyName: 'Prime Co', contactName: 'Dana', email: 'dana@prime.co' },
    project: null,
  }));
  const html = renderTemplate(t.bodyHtml, vars);
  const text = renderTemplate(t.bodyText, vars);
  ok(5, 'estimate HTML: no artifacts when project+expiration null', hasArtifacts(html).length === 0, hasArtifacts(html).join('; '));
  ok(6, 'estimate TEXT: no artifacts when project+expiration null', hasArtifacts(text).length === 0, hasArtifacts(text).join('; '));
  ok(7, 'estimate: validity sentence omitted', !/valid until/i.test(text));
  ok(8, 'estimate: ends "dated Sep 14, 2026."', /dated Sep 14, 2026\./.test(text), text.split('\n')[2] ?? '');
}

// ---- 3. Estimate email, Project + Expiration BOTH present -----------------
{
  const t = getDefaultTemplate(TEMPLATE_KEYS.ESTIMATE_NEW)!;
  const vars = mergeVariables(company, estimateVariables({
    estimateNumber: 'EST-00002',
    issueDate: new Date('2026-09-14T00:00:00Z'),
    expirationDate: new Date('2026-10-14T00:00:00Z'),
    total: 500000,
    primeContractor: { companyName: 'Prime Co', contactName: 'Dana', email: 'dana@prime.co' },
    project: { projectName: 'Downtown Ring', projectCode: 'DR-1' },
  }));
  const text = renderTemplate(t.bodyText, vars);
  ok(9, 'estimate: project phrase present when set', /for project Downtown Ring\./.test(text));
  ok(10, 'estimate: validity sentence present when set', /valid until Oct 14, 2026\./.test(text));
  ok(11, 'estimate: still no artifacts when all set', hasArtifacts(text).length === 0, hasArtifacts(text).join('; '));
}

// ---- 4. Quote email, optional fields null --------------------------------
{
  const t = getDefaultTemplate(TEMPLATE_KEYS.QUOTE_NEW)!;
  const vars = mergeVariables(company, quoteVariables({
    quoteNumber: 'QUO-00001',
    issueDate: new Date('2026-09-14T00:00:00Z'),
    expirationDate: null,
    total: 750000,
    primeContractor: { companyName: 'Prime Co', contactName: 'Dana', email: 'dana@prime.co' },
    project: null,
  }));
  const html = renderTemplate(t.bodyHtml, vars);
  const text = renderTemplate(t.bodyText, vars);
  ok(12, 'quote HTML: no artifacts when optionals null', hasArtifacts(html).length === 0, hasArtifacts(html).join('; '));
  ok(13, 'quote TEXT: no artifacts when optionals null', hasArtifacts(text).length === 0, hasArtifacts(text).join('; '));
  ok(14, 'quote: validity sentence omitted', !/valid until/i.test(text));
}

// ---- 5. Quote accepted, project null -------------------------------------
{
  const t = getDefaultTemplate(TEMPLATE_KEYS.QUOTE_ACCEPTED)!;
  const vars = mergeVariables(company, quoteVariables({
    quoteNumber: 'QUO-00002', total: 750000,
    primeContractor: { companyName: 'Prime Co', contactName: 'Dana', email: 'dana@prime.co' },
    project: null,
  }));
  const text = renderTemplate(t.bodyText, vars);
  ok(15, 'quote-accepted: no artifacts when project null', hasArtifacts(text).length === 0, hasArtifacts(text).join('; '));
  ok(16, 'quote-accepted: reads "next steps. Questions?"', /next steps\. Questions\?/.test(text));
}

// ---- 6. Invoice email (no optional phrases) always clean ------------------
{
  const t = getDefaultTemplate(TEMPLATE_KEYS.INVOICE_NEW)!;
  const vars = mergeVariables(company, invoiceVariables({
    invoiceNumber: 'INV-00001', createdAt: new Date('2026-09-14T00:00:00Z'), total: 900000,
    primeContractor: { companyName: 'Prime Co', contactName: 'Dana', email: 'dana@prime.co' },
  }));
  const text = renderTemplate(t.bodyText, vars);
  ok(17, 'invoice TEXT: no artifacts', hasArtifacts(text).length === 0, hasArtifacts(text).join('; '));
}

// ---- 7. Statement email, project null ------------------------------------
{
  const t = getDefaultTemplate(TEMPLATE_KEYS.STATEMENT_NEW)!;
  const vars = mergeVariables(company, statementVariables({
    statementNumber: 'STMT-00001',
    statementDate: new Date('2026-09-14T00:00:00Z'),
    periodStart: new Date('2026-08-01T00:00:00Z'),
    periodEnd: new Date('2026-08-31T00:00:00Z'),
    endingBalance: 123456,
    primeContractor: { companyName: 'Prime Co', contactName: 'Dana', email: 'dana@prime.co' },
    project: null,
  }));
  const text = renderTemplate(t.bodyText, vars);
  ok(18, 'statement TEXT: no artifacts when project null', hasArtifacts(text).length === 0, hasArtifacts(text).join('; '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
