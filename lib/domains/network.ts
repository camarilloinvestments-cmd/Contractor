// Appliance public-IP discovery + TCP port reachability probes.
//
// SSRF stance (hardened, §5): public-IP discovery only ever contacts a FIXED
// allowlist of IP-echo endpoints (never a user-supplied URL). Port probes:
//   * validate the hostname strictly first;
//   * resolve the hostname to IP addresses BEFORE connecting;
//   * reject every address in a private / loopback / link-local / CGNAT /
//     multicast / unspecified / ULA range (both IPv4 and IPv6) — so a domain
//     that (accidentally or maliciously) points at an internal address is never
//     contacted;
//   * when an expected appliance IP is supplied (the normal verify path),
//     require the hostname to actually resolve to that IP;
//   * connect to the RESOLVED IP literal (anti-DNS-rebinding), not the hostname;
//   * only ever use the two fixed ports (80, 443) required for ACME/HTTPS.
import net from 'net';
import dns from 'dns';
import { validateHostname } from './hostname';

// Fixed allowlist of IP-echo services (no user input reaches these).
const IPV4_ECHO = ['https://api.ipify.org', 'https://ipv4.icanhazip.com'];
const IPV6_ECHO = ['https://api6.ipify.org', 'https://ipv6.icanhazip.com'];

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export type PublicIp = {
  ipv4: string | null;
  ipv6: string | null;
  source: 'override' | 'detected' | 'none';
};

function validIpv4(s: string): boolean {
  const m = s.trim().match(IPV4_RE);
  return !!m && m.slice(1).every((o) => Number(o) >= 0 && Number(o) <= 255);
}
function validIpv6(s: string): boolean {
  return /^[0-9a-f:]+$/i.test(s.trim()) && s.includes(':');
}

// ---- Forbidden (non-public) address ranges (§5 SSRF hardening) --------------

/**
 * True if the given IPv4 literal falls in any range that must NEVER be probed:
 * unspecified 0/8, private 10/8, CGNAT 100.64/10, loopback 127/8, link-local
 * 169.254/16, private 172.16/12, private 192.168/16, multicast 224/4, reserved
 * 240/4, and the broadcast address.
 */
export function isForbiddenIpv4(ip: string): boolean {
  const m = ip.trim().match(IPV4_RE);
  if (!m) return true; // not a clean IPv4 literal => treat as forbidden
  const o = m.slice(1).map(Number);
  if (o.some((n) => n < 0 || n > 255)) return true;
  const [a, b] = o;
  if (a === 0) return true; // 0.0.0.0/8 unspecified
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // 127/8 loopback
  if (a === 169 && b === 254) return true; // 169.254/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a >= 224 && a <= 239) return true; // 224/4 multicast
  if (a >= 240) return true; // 240/4 reserved + 255.255.255.255 broadcast
  return false;
}

/**
 * True if the given IPv6 literal falls in any range that must NEVER be probed:
 * loopback ::1, unspecified ::, ULA fc00::/7, link-local fe80::/10, multicast
 * ff00::/8, and any IPv4-mapped (::ffff:x.x.x.x) form.
 */
export function isForbiddenIpv6(ip: string): boolean {
  const s = ip.trim().toLowerCase();
  if (!net.isIPv6(s)) return true; // not a clean IPv6 literal => forbidden
  if (s === '::1') return true; // loopback
  if (s === '::') return true; // unspecified
  if (s.includes('::ffff:')) return true; // IPv4-mapped
  if (s.startsWith('ff')) return true; // ff00::/8 multicast
  if (s.startsWith('fc') || s.startsWith('fd')) return true; // fc00::/7 ULA
  // fe80::/10 link-local => first hextet fe80..febf => prefixes fe8/fe9/fea/feb
  if (/^fe[89ab]/.test(s)) return true;
  return false;
}

/** Dispatch to the correct family check; unknown formats are forbidden. */
export function isForbiddenIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isForbiddenIpv4(ip);
  if (net.isIPv6(ip)) return isForbiddenIpv6(ip);
  return true;
}

/**
 * Resolve a hostname to its A and AAAA addresses. Returns the raw resolved set
 * (may include forbidden addresses — the caller filters). Never throws.
 */
export async function resolveHostAddresses(
  host: string,
): Promise<{ ipv4: string[]; ipv6: string[] }> {
  const out = { ipv4: [] as string[], ipv6: [] as string[] };
  await Promise.all([
    dns.promises.resolve4(host).then(
      (a) => {
        out.ipv4 = a;
      },
      () => {},
    ),
    dns.promises.resolve6(host).then(
      (a) => {
        out.ipv6 = a;
      },
      () => {},
    ),
  ]);
  return out;
}

async function fetchIp(url: string, kind: 'v4' | 'v6'): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!res.ok) return null;
    const body = (await res.text()).trim();
    if (kind === 'v4' && validIpv4(body)) return body;
    if (kind === 'v6' && validIpv6(body)) return body;
    return null;
  } catch {
    return null;
  }
}

/**
 * Determine the appliance's public IP(s). A configured override always wins so
 * operators behind NAT / with ambiguous discovery can pin the expected address.
 * LIVE-VM: automatic detection requires real outbound internet.
 */
export async function detectPublicIp(override?: {
  ipv4?: string | null;
  ipv6?: string | null;
}): Promise<PublicIp> {
  const ovr4 = (override?.ipv4 || process.env.APPLIANCE_PUBLIC_IPV4 || '').trim();
  const ovr6 = (override?.ipv6 || process.env.APPLIANCE_PUBLIC_IPV6 || '').trim();
  if (ovr4 && validIpv4(ovr4)) {
    return { ipv4: ovr4, ipv6: ovr6 && validIpv6(ovr6) ? ovr6 : null, source: 'override' };
  }

  let ipv4: string | null = null;
  for (const u of IPV4_ECHO) {
    ipv4 = await fetchIp(u, 'v4');
    if (ipv4) break;
  }
  let ipv6: string | null = ovr6 && validIpv6(ovr6) ? ovr6 : null;
  if (!ipv6) {
    for (const u of IPV6_ECHO) {
      ipv6 = await fetchIp(u, 'v6');
      if (ipv6) break;
    }
  }
  return { ipv4, ipv6, source: ipv4 || ipv6 ? 'detected' : 'none' };
}

export type CheckPortOptions = {
  // When set (normal verify path), the hostname MUST resolve to this appliance
  // IP or the probe is refused. Also used as the connect target.
  expectedIp?: string | null;
  timeoutMs?: number;
};

/**
 * Probe whether a TCP port is reachable, SSRF-hardened (§5):
 *   1. strict hostname validation;
 *   2. DNS resolve BEFORE connecting;
 *   3. drop every forbidden (private/loopback/etc.) address;
 *   4. if expectedIp is supplied, require the host to resolve to it;
 *   5. connect to the resolved IP literal (never the hostname) to defeat
 *      DNS-rebinding, on the fixed ACME/HTTPS port only.
 * Returns false (never throws) for any validation/resolution/connect failure.
 */
export async function checkPort(
  host: string,
  port: 80 | 443,
  options: CheckPortOptions = {},
): Promise<boolean> {
  const { expectedIp = null, timeoutMs = 5000 } = options;
  const v = validateHostname(host);
  if (!v.ok) return false;

  // If the caller pinned an expected appliance IP, it must itself be a public
  // address (defense in depth) and we target it directly after confirming DNS.
  if (expectedIp && isForbiddenIp(expectedIp)) return false;

  const resolved = await resolveHostAddresses(v.hostname);
  const publicAddrs = [...resolved.ipv4, ...resolved.ipv6].filter(
    (ip) => !isForbiddenIp(ip),
  );
  if (publicAddrs.length === 0) return false; // nothing safe to contact

  let target: string;
  if (expectedIp) {
    // Normal verify: the domain must actually resolve to the appliance IP.
    if (!publicAddrs.includes(expectedIp)) return false;
    target = expectedIp;
  } else {
    // No pin: contact the first safe resolved address.
    target = publicAddrs[0];
  }

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    // Connect to the validated, resolved, non-forbidden IP literal only.
    socket.connect(port, target);
  });
}
