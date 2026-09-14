// Phase 2 — Email provider registry.
//
// A single source of truth for the outbound-email presets the operator can pick
// in Settings → Email. Each preset fills in the SMTP host, port, transport mode
// and the supported authentication methods so the operator does not have to
// remember provider-specific details. "custom" imposes no defaults.
//
// Transport mode is explicit and unambiguous (never a bare boolean):
//   STARTTLS      connect plaintext on 587, then upgrade to TLS (STARTTLS).
//   IMPLICIT_TLS  connect with TLS from the first byte on 465 (SMTPS).
//   NONE          no transport encryption (discouraged; internal relays only).
export type TransportMode = 'STARTTLS' | 'IMPLICIT_TLS' | 'NONE';
export type AuthMethod = 'PASSWORD' | 'OAUTH2';

export const TRANSPORT_MODES: TransportMode[] = ['STARTTLS', 'IMPLICIT_TLS', 'NONE'];
export const AUTH_METHODS: AuthMethod[] = ['PASSWORD', 'OAUTH2'];

export interface ProviderPreset {
  key: string;
  label: string;
  // Default connection parameters applied when the operator selects the preset.
  host?: string;
  port?: number;
  transportMode?: TransportMode;
  // Auth methods this provider supports, most-recommended first.
  authMethods: AuthMethod[];
  // A fixed username some providers mandate (e.g. SendGrid uses "apikey").
  fixedUsername?: string;
  // Whether the host is region/account specific and must be edited by the operator.
  hostEditable?: boolean;
  // Short operator-facing guidance (no secrets; safe to render in the UI).
  notes?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: 'm365',
    label: 'Microsoft 365 / Exchange Online',
    host: 'smtp.office365.com',
    port: 587,
    transportMode: 'STARTTLS',
    authMethods: ['OAUTH2', 'PASSWORD'],
    notes:
      'Microsoft is retiring Basic Auth (username/password) for SMTP; use OAuth2 (client credentials from an Azure AD app registration). Host smtp.office365.com, port 587, STARTTLS.',
  },
  {
    key: 'gmail',
    label: 'Gmail / Google Workspace',
    host: 'smtp.gmail.com',
    port: 587,
    transportMode: 'STARTTLS',
    authMethods: ['OAUTH2', 'PASSWORD'],
    notes:
      'Use OAuth2, or an App Password (requires 2-Step Verification). Port 587 STARTTLS or 465 Implicit TLS both work.',
  },
  {
    key: 'yahoo',
    label: 'Yahoo Mail',
    host: 'smtp.mail.yahoo.com',
    port: 465,
    transportMode: 'IMPLICIT_TLS',
    authMethods: ['PASSWORD'],
    notes: 'Requires an App Password generated in your Yahoo account security settings.',
  },
  {
    key: 'icloud',
    label: 'Apple iCloud Mail',
    host: 'smtp.mail.me.com',
    port: 587,
    transportMode: 'STARTTLS',
    authMethods: ['PASSWORD'],
    notes: 'Requires an app-specific password generated at appleid.apple.com.',
  },
  {
    key: 'zoho',
    label: 'Zoho Mail',
    host: 'smtp.zoho.com',
    port: 465,
    transportMode: 'IMPLICIT_TLS',
    authMethods: ['PASSWORD'],
    notes: 'Use your Zoho mailbox credentials or an app-specific password. Regional hosts (e.g. smtp.zoho.eu) may apply.',
    hostEditable: true,
  },
  {
    key: 'fastmail',
    label: 'Fastmail',
    host: 'smtp.fastmail.com',
    port: 465,
    transportMode: 'IMPLICIT_TLS',
    authMethods: ['PASSWORD'],
    notes: 'Requires an app password created in Fastmail settings.',
  },
  {
    key: 'ses',
    label: 'Amazon SES (SMTP)',
    host: 'email-smtp.us-east-1.amazonaws.com',
    port: 587,
    transportMode: 'STARTTLS',
    authMethods: ['PASSWORD'],
    hostEditable: true,
    notes:
      'Use SES SMTP credentials (not your AWS access keys). Set the host to your SES region, e.g. email-smtp.eu-west-1.amazonaws.com.',
  },
  {
    key: 'sendgrid',
    label: 'SendGrid',
    host: 'smtp.sendgrid.net',
    port: 587,
    transportMode: 'STARTTLS',
    authMethods: ['PASSWORD'],
    fixedUsername: 'apikey',
    notes: 'Username is the literal string "apikey"; the password is your SendGrid API key.',
  },
  {
    key: 'mailgun',
    label: 'Mailgun',
    host: 'smtp.mailgun.org',
    port: 587,
    transportMode: 'STARTTLS',
    authMethods: ['PASSWORD'],
    notes: 'Use the SMTP username and password from your Mailgun domain sending settings.',
  },
  {
    key: 'postmark',
    label: 'Postmark',
    host: 'smtp.postmarkapp.com',
    port: 587,
    transportMode: 'STARTTLS',
    authMethods: ['PASSWORD'],
    notes: 'Both the SMTP username and password are your Postmark Server API token.',
  },
  {
    key: 'smtp2go',
    label: 'SMTP2GO',
    host: 'mail.smtp2go.com',
    port: 587,
    transportMode: 'STARTTLS',
    authMethods: ['PASSWORD'],
    notes: 'Use the SMTP username/password created in your SMTP2GO dashboard. Ports 587, 2525 and 8025 are supported.',
  },
  {
    key: 'custom',
    label: 'Custom SMTP',
    authMethods: ['PASSWORD', 'OAUTH2'],
    hostEditable: true,
    notes: 'Enter your own SMTP host, port, transport mode and credentials.',
  },
];

export function getProviderPreset(key?: string | null): ProviderPreset | undefined {
  if (!key) return undefined;
  return PROVIDER_PRESETS.find((p) => p.key === key);
}

export function isValidTransportMode(v: unknown): v is TransportMode {
  return typeof v === 'string' && (TRANSPORT_MODES as string[]).includes(v);
}

export function isValidAuthMethod(v: unknown): v is AuthMethod {
  return typeof v === 'string' && (AUTH_METHODS as string[]).includes(v);
}

// Public (secret-free) view of the registry for the settings UI.
export function publicProviderRegistry() {
  return PROVIDER_PRESETS.map((p) => ({
    key: p.key,
    label: p.label,
    host: p.host ?? null,
    port: p.port ?? null,
    transportMode: p.transportMode ?? null,
    authMethods: p.authMethods,
    fixedUsername: p.fixedUsername ?? null,
    hostEditable: !!p.hostEditable,
    notes: p.notes ?? null,
  }));
}
