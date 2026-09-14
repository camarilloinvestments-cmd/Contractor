// Phase 2 — categorized SMTP error classification.
//
// nodemailer/SMTP surface a wide variety of low-level failures. For the Test
// Connection and Send Test Email flows we translate them into a small set of
// stable, operator-actionable categories with a safe (secret-free) message.
// The raw error text is preserved separately for the audit log only; it is
// never guaranteed secret-free, so callers must not echo `raw` to end users.
export type EmailErrorCategory =
  | 'CONFIG'
  | 'AUTH'
  | 'CONNECTION'
  | 'TLS'
  | 'TIMEOUT'
  | 'DNS'
  | 'RECIPIENT'
  | 'RATE_LIMIT'
  | 'ENCRYPTION_KEY'
  | 'UNKNOWN';

export interface CategorizedEmailError {
  category: EmailErrorCategory;
  message: string; // safe, operator-facing
}

const SAFE_MESSAGES: Record<EmailErrorCategory, string> = {
  CONFIG: 'Email is not fully configured. Check the provider, host, port and From address.',
  AUTH: 'Authentication failed. Verify the username and password/app-password or OAuth2 credentials.',
  CONNECTION: 'Could not connect to the mail server. Check the host, port and transport mode.',
  TLS: 'TLS negotiation failed. Verify the transport mode (STARTTLS vs Implicit TLS) matches the port.',
  TIMEOUT: 'The mail server did not respond in time. Check network/firewall access to the SMTP port.',
  DNS: 'The SMTP host could not be resolved. Check the host name.',
  RECIPIENT: 'The recipient address was rejected by the mail server.',
  RATE_LIMIT: 'The mail server is rate-limiting or temporarily rejecting messages. Try again later.',
  ENCRYPTION_KEY: 'The server encryption key is missing or invalid, so stored credentials cannot be used.',
  UNKNOWN: 'Email delivery failed for an unexpected reason. See the audit log for details.',
};

// Classify a thrown error / nodemailer error object into a stable category.
export function categorizeEmailError(err: unknown): CategorizedEmailError {
  const e = (err ?? {}) as { code?: string; responseCode?: number; command?: string; message?: string; name?: string };
  const code = (e.code || '').toUpperCase();
  const msg = (e.message || '').toLowerCase();
  const responseCode = typeof e.responseCode === 'number' ? e.responseCode : undefined;

  // Our own fail-closed encryption errors.
  if (e.name === 'EncryptionKeyError' || msg.includes('app_encryption_key') || msg.includes('encryption key')) {
    return { category: 'ENCRYPTION_KEY', message: SAFE_MESSAGES.ENCRYPTION_KEY };
  }
  if (e.name === 'EmailNotConfiguredError' || msg.includes('not configured') || msg.includes('is disabled') || msg.includes('required')) {
    return { category: 'CONFIG', message: SAFE_MESSAGES.CONFIG };
  }

  // Authentication: SMTP 535/534/530, or EAUTH.
  if (code === 'EAUTH' || responseCode === 535 || responseCode === 534 || responseCode === 530 ||
      msg.includes('invalid login') || msg.includes('authentication') || msg.includes('username and password')) {
    return { category: 'AUTH', message: SAFE_MESSAGES.AUTH };
  }

  // DNS resolution.
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || msg.includes('getaddrinfo')) {
    return { category: 'DNS', message: SAFE_MESSAGES.DNS };
  }

  // Connection refused/reset/unreachable.
  if (code === 'ECONNECTION' || code === 'ECONNREFUSED' || code === 'ECONNRESET' ||
      code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || msg.includes('connection refused')) {
    return { category: 'CONNECTION', message: SAFE_MESSAGES.CONNECTION };
  }

  // Timeouts.
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' && msg.includes('timeout') || msg.includes('timed out') || msg.includes('timeout')) {
    return { category: 'TIMEOUT', message: SAFE_MESSAGES.TIMEOUT };
  }

  // TLS / certificate problems (ESOCKET frequently carries TLS failures).
  if (code === 'ETLS' || msg.includes('tls') || msg.includes('ssl') || msg.includes('certificate') ||
      msg.includes('wrong version number') || (code === 'ESOCKET')) {
    return { category: 'TLS', message: SAFE_MESSAGES.TLS };
  }

  // Recipient rejected: 550/551/553.
  if (code === 'EENVELOPE' || responseCode === 550 || responseCode === 551 || responseCode === 553 ||
      msg.includes('recipient') || msg.includes('mailbox')) {
    return { category: 'RECIPIENT', message: SAFE_MESSAGES.RECIPIENT };
  }

  // Rate limiting / greylisting: 421/450/451/452.
  if (responseCode === 421 || responseCode === 450 || responseCode === 451 || responseCode === 452 ||
      msg.includes('rate limit') || msg.includes('too many')) {
    return { category: 'RATE_LIMIT', message: SAFE_MESSAGES.RATE_LIMIT };
  }

  return { category: 'UNKNOWN', message: SAFE_MESSAGES.UNKNOWN };
}

export function safeMessageFor(category: EmailErrorCategory): string {
  return SAFE_MESSAGES[category];
}
