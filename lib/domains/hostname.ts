// Strict hostname normalization + validation for the Domain & SSL feature.
//
// This is the security frontier for the whole feature: every hostname that
// reaches DNS resolution, proxy config generation, or a certificate request
// MUST pass validateHostname() first. It is a pure function (no I/O) so the
// acceptance harness can exercise it directly and exhaustively.
//
// Accepts:  app.onsiteug.com   (a normal public FQDN, >= 2 labels)
// Rejects:  schemes (https://...), paths (.../x), ports (:443), spaces,
//           shell metacharacters ($ ( ) ; & | ` < > etc.), localhost, raw IPs,
//           wildcards, and anything that is not a syntactically valid hostname.

export type HostnameValidation =
  | { ok: true; hostname: string }
  | { ok: false; reason: string };

// Characters that must never appear in a hostname. Anything outside the
// RFC-1123 label alphabet is rejected anyway, but we call out shell/URL
// metacharacters explicitly for clear operator errors and defense in depth.
const FORBIDDEN_CHARS =
  /[\s/\\:?#@!$%^&*()+=\[\]{}|;'"`~<>,]/;

// A single DNS label: 1-63 chars, alphanumerics and hyphens, not starting or
// ending with a hyphen.
const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

// Reserved / non-routable names that must never be treated as a public domain.
const RESERVED_NAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'broadcasthost',
]);

function isIpv4(s: string): boolean {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  return m.slice(1).every((o) => Number(o) >= 0 && Number(o) <= 255);
}

function looksLikeIpv6(s: string): boolean {
  // Colons are already forbidden, but guard explicitly for clarity.
  return s.includes(':');
}

/**
 * Normalize a candidate hostname: trim, strip a single trailing dot, lowercase.
 * Does NOT strip schemes/paths/ports — those are rejected by validate, not
 * silently "cleaned", so an operator who pasted a URL gets a clear error.
 */
export function normalizeHostname(input: string): string {
  return String(input ?? '')
    .trim()
    .replace(/\.$/, '')
    .toLowerCase();
}

/**
 * Strictly validate a hostname. Returns the normalized hostname on success or a
 * specific, operator-safe reason on failure.
 */
export function validateHostname(input: unknown): HostnameValidation {
  if (typeof input !== 'string') return { ok: false, reason: 'Hostname must be text.' };
  const raw = input.trim();
  if (!raw) return { ok: false, reason: 'Enter a domain name.' };

  // Reject obvious URL forms up front for a friendlier message.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    return { ok: false, reason: 'Enter a bare hostname without a scheme (no http:// or https://).' };
  }
  if (raw.includes('/')) return { ok: false, reason: 'Enter a bare hostname without a path.' };
  if (/:\d+$/.test(raw) || raw.includes(':')) {
    return { ok: false, reason: 'Enter a bare hostname without a port.' };
  }
  if (/\s/.test(raw)) return { ok: false, reason: 'Hostname cannot contain spaces.' };
  if (FORBIDDEN_CHARS.test(raw)) {
    return { ok: false, reason: 'Hostname contains invalid characters.' };
  }
  if (raw.startsWith('*')) return { ok: false, reason: 'Wildcard domains are not supported.' };

  const host = normalizeHostname(raw);
  if (host.length > 253) return { ok: false, reason: 'Hostname is too long.' };
  if (RESERVED_NAMES.has(host)) return { ok: false, reason: 'Reserved hostnames are not allowed.' };
  if (isIpv4(host) || looksLikeIpv6(host)) {
    return { ok: false, reason: 'Enter a domain name, not an IP address.' };
  }

  const labels = host.split('.');
  if (labels.length < 2) {
    return { ok: false, reason: 'Enter a fully-qualified domain (e.g. app.example.com).' };
  }
  for (const label of labels) {
    if (!LABEL_RE.test(label)) {
      return { ok: false, reason: 'Hostname has an invalid label.' };
    }
  }
  // TLD must be alphabetic and at least 2 chars (rejects trailing numeric TLDs
  // and single-char TLDs).
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/.test(tld)) {
    return { ok: false, reason: 'Hostname has an invalid top-level domain.' };
  }

  return { ok: true, hostname: host };
}

/** Convenience boolean form. */
export function isValidHostname(input: unknown): boolean {
  return validateHostname(input).ok;
}
