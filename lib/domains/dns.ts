// DNS resolution for domain verification. Uses Node's resolver directly — no
// outbound HTTP to an arbitrary host, so there is no SSRF surface here: we only
// ever look up A/AAAA records for a hostname that already passed strict
// validation.
import { promises as dns } from 'dns';
import { validateHostname } from './hostname';
import { DNS_STATUS, type DnsStatus } from './index';

export type DnsResult = {
  status: DnsStatus;
  ipv4: string[];
  ipv6: string[];
  error?: string;
};

async function resolveRecord(host: string, kind: 'A' | 'AAAA'): Promise<string[]> {
  try {
    return kind === 'A' ? await dns.resolve4(host) : await dns.resolve6(host);
  } catch (err: any) {
    // ENODATA / ENOTFOUND simply mean "no records of this type" — not fatal for
    // AAAA (IPv6 is optional). Re-throw only truly unexpected errors.
    if (err && (err.code === 'ENODATA' || err.code === 'ENOTFOUND' || err.code === 'ESERVFAIL')) {
      return [];
    }
    throw err;
  }
}

/**
 * Resolve A (and, if present, AAAA) records for a validated hostname and compare
 * them against the appliance's expected public IP(s).
 */
export async function resolveDomain(
  hostname: string,
  expected: { ipv4?: string | null; ipv6?: string | null }
): Promise<DnsResult> {
  const v = validateHostname(hostname);
  if (!v.ok) return { status: DNS_STATUS.ERROR, ipv4: [], ipv6: [], error: 'invalid hostname' };
  const host = v.hostname;

  let ipv4: string[] = [];
  let ipv6: string[] = [];
  try {
    [ipv4, ipv6] = await Promise.all([resolveRecord(host, 'A'), resolveRecord(host, 'AAAA')]);
  } catch (err: any) {
    if (err && (err.code === 'ENOTFOUND' || err.code === 'ENODATA')) {
      return { status: DNS_STATUS.NXDOMAIN, ipv4: [], ipv6: [] };
    }
    return { status: DNS_STATUS.ERROR, ipv4, ipv6, error: 'dns lookup failed' };
  }

  if (ipv4.length === 0 && ipv6.length === 0) {
    return { status: DNS_STATUS.NXDOMAIN, ipv4, ipv6 };
  }

  // Determine whether the domain points at THIS appliance. IPv4 is authoritative
  // for the match decision; IPv6 is corroborating when both sides have it.
  const v4Match = expected.ipv4 ? ipv4.includes(expected.ipv4) : ipv4.length > 0;
  const v6Match =
    expected.ipv6 && ipv6.length > 0 ? ipv6.includes(expected.ipv6) : true;

  const matches = expected.ipv4 ? v4Match && v6Match : v4Match;
  return { status: matches ? DNS_STATUS.OK : DNS_STATUS.MISMATCH, ipv4, ipv6 };
}
