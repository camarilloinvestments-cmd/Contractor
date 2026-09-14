// Certificate status inspection.
//
// We inspect certificates by performing a TLS handshake to the domain on 443 and
// reading the PEER (public) certificate only — issuer, serial, validity window.
// Private key material is owned by Caddy inside its persistent data volume and is
// NEVER read, stored, logged or returned. LIVE-VM: a real handshake needs a
// reachable, certificate-serving endpoint.
import tls from 'tls';
import { validateHostname } from './hostname';
import { SSL_STATUS, type SslStatus, RENEWAL_WINDOW_DAYS } from './index';

export type CertInfo = {
  issuer: string | null;
  serial: string | null;
  notBefore: Date | null;
  notAfter: Date | null;
  status: SslStatus;
  error?: string;
};

/** Derive an SSL status purely from the validity window (pure, testable). */
export function statusFromValidity(notAfter: Date | null, now: Date = new Date()): SslStatus {
  if (!notAfter) return SSL_STATUS.NONE;
  const ms = notAfter.getTime() - now.getTime();
  if (ms <= 0) return SSL_STATUS.EXPIRED;
  const days = ms / 86_400_000;
  if (days <= RENEWAL_WINDOW_DAYS) return SSL_STATUS.RENEWAL_DUE;
  return SSL_STATUS.ACTIVE;
}

function issuerToString(issuer: any): string | null {
  if (!issuer) return null;
  // Prefer the organization, then common name. Never include anything secret.
  return issuer.O || issuer.CN || null;
}

/**
 * Inspect the live certificate served for a hostname. Returns public metadata
 * only. LIVE-VM in environments without public reachability.
 */
export async function inspectCertificate(hostname: string, timeoutMs = 5000): Promise<CertInfo> {
  const v = validateHostname(hostname);
  if (!v.ok) {
    return { issuer: null, serial: null, notBefore: null, notAfter: null, status: SSL_STATUS.ERROR, error: 'invalid hostname' };
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (info: CertInfo) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* noop */ }
      resolve(info);
    };
    const socket = tls.connect(
      { host: v.hostname, servername: v.hostname, port: 443, timeout: timeoutMs, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        if (!cert || Object.keys(cert).length === 0) {
          return finish({ issuer: null, serial: null, notBefore: null, notAfter: null, status: SSL_STATUS.ERROR, error: 'no certificate presented' });
        }
        const notBefore = cert.valid_from ? new Date(cert.valid_from) : null;
        const notAfter = cert.valid_to ? new Date(cert.valid_to) : null;
        finish({
          issuer: issuerToString(cert.issuer),
          serial: cert.serialNumber || null,
          notBefore,
          notAfter,
          status: statusFromValidity(notAfter),
        });
      }
    );
    socket.once('timeout', () => finish({ issuer: null, serial: null, notBefore: null, notAfter: null, status: SSL_STATUS.ERROR, error: 'connection timed out' }));
    socket.once('error', () => finish({ issuer: null, serial: null, notBefore: null, notAfter: null, status: SSL_STATUS.ERROR, error: 'tls handshake failed' }));
  });
}
