// Domain & SSL control plane — shared constants, types and status vocabularies.
//
// This module is the single source of truth for the Domain & SSL feature's
// status values, audit action names, and operator-safe error codes. Everything
// here is pure data (no side effects) so it is safe to import from server
// routes, the service layer, and the acceptance harness alike.
//
// SECURITY NOTES that hold across the whole feature:
//   * Hostnames are validated STRICTLY (lib/domains/hostname.ts) before any use.
//   * We NEVER execute a user-supplied shell string. Host operations go through
//     fixed executables with fixed argument vectors (spawn without a shell) or a
//     restricted Node helper.
//   * We NEVER store, log, or return private certificate key material. Caddy owns
//     the keys inside its persistent data volume; OS1 only reads public metadata.
//   * Outbound network probes only ever target the domain being verified (its
//     resolved address) on ports 80/443, or a FIXED allowlist of IP-echo
//     endpoints — never an arbitrary user-supplied URL (no SSRF).

// ---- Domain lifecycle status (HostedDomain.status) --------------------------
export const DOMAIN_STATUS = {
  PENDING: 'PENDING',
  VERIFYING: 'VERIFYING',
  DNS_ERROR: 'DNS_ERROR',
  PORT_ERROR: 'PORT_ERROR',
  READY: 'READY',
  ISSUING: 'ISSUING',
  ACTIVE: 'ACTIVE',
  RENEWAL_DUE: 'RENEWAL_DUE',
  RENEWING: 'RENEWING',
  CERT_ERROR: 'CERT_ERROR',
  DISABLED: 'DISABLED',
} as const;
export type DomainStatus = (typeof DOMAIN_STATUS)[keyof typeof DOMAIN_STATUS];
export const DOMAIN_STATUS_VALUES = Object.values(DOMAIN_STATUS);

// ---- DNS check status (HostedDomain.dnsStatus) ------------------------------
export const DNS_STATUS = {
  UNKNOWN: 'UNKNOWN',
  OK: 'OK',
  MISMATCH: 'MISMATCH',
  NXDOMAIN: 'NXDOMAIN',
  ERROR: 'ERROR',
} as const;
export type DnsStatus = (typeof DNS_STATUS)[keyof typeof DNS_STATUS];

// ---- SSL/certificate status (HostedDomain.sslStatus) ------------------------
export const SSL_STATUS = {
  NONE: 'NONE',
  ISSUING: 'ISSUING',
  ACTIVE: 'ACTIVE',
  RENEWAL_DUE: 'RENEWAL_DUE',
  RENEWING: 'RENEWING',
  EXPIRED: 'EXPIRED',
  ERROR: 'ERROR',
} as const;
export type SslStatus = (typeof SSL_STATUS)[keyof typeof SSL_STATUS];

// ---- Audit action names (see §18) ------------------------------------------
export const DOMAIN_AUDIT = {
  CREATED: 'domain.created',
  UPDATED: 'domain.updated',
  VERIFIED: 'domain.verified',
  SSL_ENABLED: 'ssl.enabled',
  SSL_ISSUED: 'ssl.issued',
  SSL_REISSUED: 'ssl.reissued',
  SSL_RENEWED: 'ssl.renewed',
  SSL_DISABLED: 'ssl.disabled',
  PROXY_CONFIG_UPDATED: 'proxy.config_updated',
  PROXY_RELOAD_FAILED: 'proxy.reload_failed',
  CANONICAL_URL_CHANGED: 'domain.canonical_url_changed',
  CANONICAL_URL_ROLLED_BACK: 'domain.canonical_url_rolled_back',
} as const;

// ---- Operator-safe error codes (see §16) -----------------------------------
// These are the ONLY strings surfaced to operators. Underlying exceptions/stack
// traces / raw shell output are logged server-side (secret-scrubbed) but never
// returned to the client.
export const DOMAIN_ERROR = {
  DNS_NOT_POINTING: 'DNS NOT POINTING TO THIS SERVER',
  PORT_80_UNREACHABLE: 'PORT 80 NOT REACHABLE',
  PORT_443_UNREACHABLE: 'PORT 443 NOT REACHABLE',
  ACME_CHALLENGE_FAILED: 'ACME CHALLENGE FAILED',
  RATE_LIMITED: "LET'S ENCRYPT RATE LIMITED",
  ISSUANCE_FAILED: 'CERTIFICATE ISSUANCE FAILED',
  PROXY_CONFIG_INVALID: 'PROXY CONFIG INVALID',
  PROXY_RELOAD_FAILED: 'PROXY RELOAD FAILED',
  CERT_EXPIRED: 'CERTIFICATE EXPIRED',
  DOMAIN_IN_USE: 'DOMAIN ALREADY IN USE',
  INVALID_HOSTNAME: 'INVALID HOSTNAME',
  NOT_VERIFIED: 'DOMAIN NOT VERIFIED — RUN VERIFY FIRST',
  RATE_LIMIT_OPERATION: 'TOO MANY REQUESTS — TRY AGAIN SHORTLY',
} as const;

// Certificate provider (only Let's Encrypt via Caddy ACME in v1).
export const CERT_PROVIDER = "Let's Encrypt";

// Renew when the certificate is within this many days of expiry (Caddy renews
// ~30 days out; OS1 surfaces RENEWAL_DUE at the same threshold).
export const RENEWAL_WINDOW_DAYS = 30;

// Per-operation rate limits (see §17). Windowed, in-memory, best-effort — a
// coarse guard against accidental hammering / Let's Encrypt rate-limit burn.
export const RATE_LIMITS = {
  verify: { max: 10, windowMs: 60_000 },
  reissue: { max: 3, windowMs: 60 * 60_000 },
  enable: { max: 5, windowMs: 60 * 60_000 },
} as const;
