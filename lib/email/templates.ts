// Default email templates + template accessors (Phase 1 / v1.1.0).
//
// Templates are stored in the EmailTemplate table and edited via the admin UI.
// These defaults are seeded idempotently (see scripts/safe-seed.ts) and are also
// used as a fallback if a template row is missing. Bodies use ONLY allow-listed
// {{variables}} (see lib/email/allowlist.ts).
import { prisma } from '@/lib/prisma';

export type DefaultTemplate = {
  key: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
};

export const TEMPLATE_KEYS = {
  INVOICE_NEW: 'invoice_new',
  INVOICE_REMINDER: 'invoice_reminder',
  ESTIMATE_NEW: 'estimate_new',
  QUOTE_NEW: 'quote_new',
  QUOTE_ACCEPTED: 'quote_accepted',
  STATEMENT_NEW: 'statement_new',
  TEST: 'test_email',
} as const;

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    key: TEMPLATE_KEYS.INVOICE_NEW,
    name: 'New Invoice',
    subject: 'Invoice {{invoice_number}} from {{company_name}}',
    bodyHtml: `<p>Dear {{prime_contractor_name}},</p>
<p>Please find attached invoice <strong>{{invoice_number}}</strong> dated {{invoice_date}} for the amount of <strong>{{invoice_total}}</strong>.</p>
<p>Outstanding balance: {{invoice_balance}}</p>
<p>If you have any questions about this invoice, contact us at {{support_email}} or {{support_phone}}.</p>
<p>Thank you for your business,<br/>{{company_name}}<br/>{{company_website}}</p>`,
    bodyText: `Dear {{prime_contractor_name}},

Please find attached invoice {{invoice_number}} dated {{invoice_date}} for the amount of {{invoice_total}}.

Outstanding balance: {{invoice_balance}}

If you have any questions, contact us at {{support_email}} or {{support_phone}}.

Thank you for your business,
{{company_name}}
{{company_website}}`,
  },
  {
    key: TEMPLATE_KEYS.INVOICE_REMINDER,
    name: 'Invoice Reminder',
    subject: 'Reminder: Invoice {{invoice_number}} is due {{invoice_due_date}}',
    bodyHtml: `<p>Dear {{prime_contractor_name}},</p>
<p>This is a friendly reminder that invoice <strong>{{invoice_number}}</strong> for {{invoice_total}} is due on {{invoice_due_date}}.</p>
<p>Outstanding balance: <strong>{{invoice_balance}}</strong></p>
<p>Questions? Reach us at {{support_email}} or {{support_phone}}.</p>
<p>{{company_name}}</p>`,
    bodyText: `Dear {{prime_contractor_name}},

This is a friendly reminder that invoice {{invoice_number}} for {{invoice_total}} is due on {{invoice_due_date}}.

Outstanding balance: {{invoice_balance}}

Questions? Reach us at {{support_email}} or {{support_phone}}.

{{company_name}}`,
  },
  {
    key: TEMPLATE_KEYS.ESTIMATE_NEW,
    name: 'New Estimate',
    subject: 'Estimate {{estimate_number}} from {{company_name}}',
    bodyHtml: `<p>Dear {{contact_name}},</p>
<p>Please find attached estimate <strong>{{estimate_number}}</strong> dated {{issue_date}}{{#if project_name}} for project {{project_name}}{{/if}}.</p>
<p>Estimated total: <strong>{{estimate_total}}</strong></p>
<p>{{#if expiration_date}}This estimate is valid until {{expiration_date}}. {{/if}}If you have any questions, contact us at {{support_email}} or {{support_phone}}.</p>
<p>Thank you,<br/>{{company_name}}<br/>{{company_website}}</p>`,
    bodyText: `Dear {{contact_name}},

Please find attached estimate {{estimate_number}} dated {{issue_date}}{{#if project_name}} for project {{project_name}}{{/if}}.

Estimated total: {{estimate_total}}

{{#if expiration_date}}This estimate is valid until {{expiration_date}}. {{/if}}If you have any questions, contact us at {{support_email}} or {{support_phone}}.

Thank you,
{{company_name}}
{{company_website}}`,
  },
  {
    key: TEMPLATE_KEYS.QUOTE_NEW,
    name: 'New Quote',
    subject: 'Quote {{quote_number}} from {{company_name}}',
    bodyHtml: `<p>Dear {{contact_name}},</p>
<p>Please find attached quote <strong>{{quote_number}}</strong> dated {{issue_date}}{{#if project_name}} for project {{project_name}}{{/if}}.</p>
<p>Quote total: <strong>{{quote_total}}</strong></p>
<p>{{#if expiration_date}}This quote is valid until {{expiration_date}}. {{/if}}To review or accept, contact us at {{support_email}} or {{support_phone}}.</p>
<p>Thank you,<br/>{{company_name}}<br/>{{company_website}}</p>`,
    bodyText: `Dear {{contact_name}},

Please find attached quote {{quote_number}} dated {{issue_date}}{{#if project_name}} for project {{project_name}}{{/if}}.

Quote total: {{quote_total}}

{{#if expiration_date}}This quote is valid until {{expiration_date}}. {{/if}}To review or accept, contact us at {{support_email}} or {{support_phone}}.

Thank you,
{{company_name}}
{{company_website}}`,
  },
  {
    key: TEMPLATE_KEYS.QUOTE_ACCEPTED,
    name: 'Quote Accepted',
    subject: 'Quote {{quote_number}} accepted — {{company_name}}',
    bodyHtml: `<p>Dear {{contact_name}},</p>
<p>Thank you — quote <strong>{{quote_number}}</strong> for {{quote_total}} has been accepted.</p>
<p>We will proceed with the next steps{{#if project_name}} for project {{project_name}}{{/if}}. Questions? Reach us at {{support_email}} or {{support_phone}}.</p>
<p>{{company_name}}</p>`,
    bodyText: `Dear {{contact_name}},

Thank you — quote {{quote_number}} for {{quote_total}} has been accepted.

We will proceed with the next steps{{#if project_name}} for project {{project_name}}{{/if}}. Questions? Reach us at {{support_email}} or {{support_phone}}.

{{company_name}}`,
  },
  {
    key: TEMPLATE_KEYS.STATEMENT_NEW,
    name: 'New Statement',
    subject: 'Statement {{statement_number}} from {{company_name}}',
    bodyHtml: `<p>Dear {{contact_name}},</p>
<p>Please find attached account statement <strong>{{statement_number}}</strong> dated {{statement_date}} for the period {{period_start}} to {{period_end}}.</p>
<p>Balance due: <strong>{{statement_balance}}</strong></p>
<p>If you have any questions about this statement, contact us at {{support_email}} or {{support_phone}}.</p>
<p>Thank you for your business,<br/>{{company_name}}<br/>{{company_website}}</p>`,
    bodyText: `Dear {{contact_name}},

Please find attached account statement {{statement_number}} dated {{statement_date}} for the period {{period_start}} to {{period_end}}.

Balance due: {{statement_balance}}

If you have any questions about this statement, contact us at {{support_email}} or {{support_phone}}.

Thank you for your business,
{{company_name}}
{{company_website}}`,
  },
  {
    key: TEMPLATE_KEYS.TEST,
    name: 'Test Email',
    subject: 'Test email from {{company_name}}',
    bodyHtml: `<p>This is a test email from {{company_name}}.</p>
<p>If you received this message, your outbound email configuration is working correctly.</p>`,
    bodyText: `This is a test email from {{company_name}}.

If you received this message, your outbound email configuration is working correctly.`,
  },
];

export function getDefaultTemplate(key: string): DefaultTemplate | undefined {
  return DEFAULT_TEMPLATES.find((t) => t.key === key);
}

// Load a template by key from the DB, falling back to the built-in default.
export async function getTemplate(key: string): Promise<DefaultTemplate | null> {
  try {
    const row = await prisma.emailTemplate.findUnique({ where: { key } });
    if (row && row.isActive) {
      return {
        key: row.key,
        name: row.name,
        subject: row.subject,
        bodyHtml: row.bodyHtml,
        bodyText: row.bodyText ?? '',
      };
    }
  } catch {
    /* table may not exist pre-migration */
  }
  return getDefaultTemplate(key) ?? null;
}
