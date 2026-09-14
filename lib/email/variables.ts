// Builds allow-listed template variables from domain objects (Phase 1).
// Everything returned here maps to a key in lib/email/allowlist.ts.
import { formatCents } from '@/lib/utils/format';
import type { CompanyBranding } from '@/lib/branding';
import type { TemplateVariables } from './allowlist';

function fmtDate(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function companyVariables(b: CompanyBranding): TemplateVariables {
  const addressParts = [b.address, [b.city, b.state, b.zip].filter(Boolean).join(', ')]
    .filter(Boolean)
    .join(', ');
  return {
    company_name: b.companyName,
    company_address: addressParts,
    company_website: b.website ?? '',
    support_email: b.supportEmail ?? b.email ?? '',
    support_phone: b.supportPhone ?? b.phone ?? '',
    portal_url: b.portalUrl ?? '',
  };
}

type InvoiceForVars = {
  invoiceNumber?: string | null;
  createdAt?: Date | string | null;
  total?: number | null;
  primeContractor?: {
    companyName?: string | null;
    contactName?: string | null;
    email?: string | null;
  } | null;
};

export function invoiceVariables(invoice: InvoiceForVars): TemplateVariables {
  const pc = invoice.primeContractor ?? undefined;
  return {
    invoice_number: invoice.invoiceNumber ?? '',
    invoice_date: fmtDate(invoice.createdAt),
    invoice_total: formatCents(invoice.total ?? 0),
    // Balance defaults to total until a payments module lands (Phase 2+).
    invoice_balance: formatCents(invoice.total ?? 0),
    prime_contractor_name: pc?.companyName ?? '',
    customer_name: pc?.contactName ?? pc?.companyName ?? '',
    customer_email: pc?.email ?? '',
  };
}

export function mergeVariables(...parts: TemplateVariables[]): TemplateVariables {
  return Object.assign({}, ...parts);
}

type PrimeForVars = {
  companyName?: string | null;
  contactName?: string | null;
  email?: string | null;
} | null | undefined;

type EstimateForVars = {
  estimateNumber?: string | null;
  issueDate?: Date | string | null;
  expirationDate?: Date | string | null;
  total?: number | null;
  title?: string | null;
  primeContractor?: PrimeForVars;
  project?: { projectName?: string | null; projectCode?: string | null } | null;
};

export function estimateVariables(estimate: EstimateForVars): TemplateVariables {
  const pc = estimate.primeContractor ?? undefined;
  const total = formatCents(estimate.total ?? 0);
  return {
    document_number: estimate.estimateNumber ?? '',
    estimate_number: estimate.estimateNumber ?? '',
    document_total: total,
    estimate_total: total,
    issue_date: fmtDate(estimate.issueDate),
    estimate_date: fmtDate(estimate.issueDate),
    expiration_date: fmtDate(estimate.expirationDate),
    prime_contractor_name: pc?.companyName ?? '',
    customer_name: pc?.contactName ?? pc?.companyName ?? '',
    contact_name: pc?.contactName ?? '',
    customer_email: pc?.email ?? '',
    project_name: estimate.project?.projectName ?? estimate.project?.projectCode ?? '',
  };
}

type QuoteForVars = {
  quoteNumber?: string | null;
  issueDate?: Date | string | null;
  expirationDate?: Date | string | null;
  total?: number | null;
  title?: string | null;
  primeContractor?: PrimeForVars;
  project?: { projectName?: string | null; projectCode?: string | null } | null;
  salesperson?: { name?: string | null } | null;
};

export function quoteVariables(quote: QuoteForVars): TemplateVariables {
  const pc = quote.primeContractor ?? undefined;
  const total = formatCents(quote.total ?? 0);
  return {
    document_number: quote.quoteNumber ?? '',
    quote_number: quote.quoteNumber ?? '',
    document_total: total,
    quote_total: total,
    issue_date: fmtDate(quote.issueDate),
    quote_date: fmtDate(quote.issueDate),
    expiration_date: fmtDate(quote.expirationDate),
    prime_contractor_name: pc?.companyName ?? '',
    customer_name: pc?.contactName ?? pc?.companyName ?? '',
    contact_name: pc?.contactName ?? '',
    customer_email: pc?.email ?? '',
    project_name: quote.project?.projectName ?? quote.project?.projectCode ?? '',
    salesperson_name: quote.salesperson?.name ?? '',
  };
}
