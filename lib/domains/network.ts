// Appliance public-IP discovery + TCP port reachability probes.
//
// SSRF stance: public-IP discovery only ever contacts a FIXED allowlist of
// IP-echo endpoints (never a user-supplied URL). Port probes only ever target a
// hostname/IP that has already passed strict validation, and only on the two
// fixed ports (80, 443) required for ACME/HTTPS. No arbitrary host:port from
// free-form input is ever contacted.
import net from 'net';
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

/**
 * Probe whether a TCP port is reachable on the given (validated) host.
 * LIVE-VM: meaningful only where 80/443 are actually routable to this appliance.
 */
export async function checkPort(
  host: string,
  port: 80 | 443,
  timeoutMs = 5000
): Promise<boolean> {
  const v = validateHostname(host);
  if (!v.ok) return false;
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
    // Only the fixed ACME/HTTPS ports are ever contacted, on the validated host.
    socket.connect(port, v.hostname);
  });
}
