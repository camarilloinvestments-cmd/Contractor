// Blocker 1 — OpenAI endpoint pinning (SSRF / credential-exfiltration guard).
//
// The stored OpenAI API key is a bearer credential. It must ONLY ever be sent to
// the official OpenAI API. Historically an ADMIN-editable "API Base URL" was
// stored and used verbatim as the fetch target, which meant an operator (or a
// tampered settings row) could redirect the credential to an arbitrary host
// (example.com, localhost, an RFC-1918 metadata endpoint, a look-alike domain).
//
// This module owns the single approved endpoint. The server ALWAYS resolves the
// endpoint through here before attaching the credential:
//   * no stored base            -> official endpoint
//   * stored base EXACTLY approved -> that (still official) endpoint
//   * anything else             -> THROW (credential is never sent)
//
// Additional providers (e.g. Azure OpenAI) are intentionally NOT accepted here;
// they require a separate, explicitly-authorized connector — not a free-text URL.

export class AiEndpointSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiEndpointSecurityError';
  }
}

// The one and only endpoint the stored credential may be sent to.
export const OFFICIAL_OPENAI_API_BASE = 'https://api.openai.com/v1';

// Exact set of approved base URLs (normalized, no trailing slash). Kept as a set
// so the policy is explicit and auditable rather than a loose regex.
const APPROVED_BASES = new Set<string>([OFFICIAL_OPENAI_API_BASE]);

function normalize(base: string): string {
  return base.trim().replace(/\/+$/, '');
}

// True only for a base that is byte-for-byte one of the approved official bases.
export function isApprovedOpenAiEndpoint(base: string | null | undefined): boolean {
  if (!base || !base.trim()) return false;
  return APPROVED_BASES.has(normalize(base));
}

// Assert that `base` is an approved official endpoint, or throw. Never returns a
// non-approved URL, so a caller that attaches the credential to the result can
// never leak it. Rejects localhost, RFC-1918/private hosts, alternate hostnames,
// non-https schemes and any arbitrary operator-supplied URL by construction
// (only an exact official match passes).
export function assertApprovedOpenAiEndpoint(base: string | null | undefined): string {
  if (base == null || !base.trim()) return OFFICIAL_OPENAI_API_BASE;
  const normalized = normalize(base);
  if (!APPROVED_BASES.has(normalized)) {
    throw new AiEndpointSecurityError(
      'Refusing to send the OpenAI credential to a non-official endpoint. The API endpoint is pinned to the official OpenAI API.',
    );
  }
  return normalized;
}

// Resolve the endpoint to use for a request given the (possibly legacy/stored)
// base. Server code MUST call this and use the return value as the fetch target;
// it must never fetch a raw stored base directly.
export function resolveOpenAiApiBase(storedBase: string | null | undefined): string {
  return assertApprovedOpenAiEndpoint(storedBase);
}
