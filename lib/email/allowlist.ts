// Allow-listed email template variables (Phase 1 / ruling #10).
//
// ONLY these variables may appear in an email template. Rendering performs a
// literal string substitution of {{variable}} tokens with values taken from this
// fixed set. There is NO expression evaluation, NO property access, and NO
// server-side code execution of any kind. Unknown tokens are left untouched (or
// stripped, see renderer) rather than resolved dynamically.

export const ALLOWED_VARIABLES = [
  'company_name',
  'company_address',
  'company_website',
  'support_email',
  'support_phone',
  'customer_name',
  'customer_email',
  'prime_contractor_name',
  'invoice_number',
  'invoice_date',
  'invoice_total',
  'invoice_balance',
  'invoice_due_date',
  'payment_link',
  'payment_amount',
  'payment_date',
  'payment_reference',
  'job_number',
  'job_name',
  'project_name',
  // Generic commercial-document variables (Estimate / Quote / Invoice)
  'document_number',
  'document_total',
  'issue_date',
  'due_date',
  'expiration_date',
  'contact_name',
  'estimate_number',
  'estimate_total',
  'estimate_date',
  'quote_number',
  'quote_total',
  'quote_date',
  'statement_number',
  'statement_date',
  'statement_total',
  'statement_balance',
  'period_start',
  'period_end',
  'document_view_link',
  'worker_name',
  'subcontractor_name',
  'salesperson_name',
  'portal_url',
  'login_url',
] as const;

export type AllowedVariable = (typeof ALLOWED_VARIABLES)[number];

export type TemplateVariables = Partial<Record<AllowedVariable, string>>;

export function isAllowedVariable(name: string): name is AllowedVariable {
  return (ALLOWED_VARIABLES as readonly string[]).includes(name);
}
