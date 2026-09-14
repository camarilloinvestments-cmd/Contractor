// Domain & SSL — read-only diagnostics for one domain. ADMIN only.
// Returns the REDACTED generated proxy config (read-only, no editable Caddyfile
// ever exposed) and public certificate metadata. Never returns private keys.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/domains/guard';
import { inspectCertificate } from '@/lib/domains/cert';
import {
  generateCaddyfile,
  redactConfigForDisplay,
  GENERATED_CADDYFILE_PATH,
} from '@/lib/domains/caddy';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.response;
  const { id } = await params;

  const domain = await prisma.hostedDomain.findUnique({ where: { id } });
  if (!domain) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Show what the generated config for THIS domain looks like (redacted,
  // read-only). This is derived from validated structured values only.
  const gen = generateCaddyfile([{ hostname: domain.hostname }]);
  const configPreview = gen.ok ? redactConfigForDisplay(gen.caddyfile) : '# (config unavailable)';

  // Live cert inspection (public metadata only). LIVE-VM where unreachable.
  const cert = await inspectCertificate(domain.hostname);

  return NextResponse.json({
    domain: {
      id: domain.id,
      hostname: domain.hostname,
      status: domain.status,
      dnsStatus: domain.dnsStatus,
      sslStatus: domain.sslStatus,
      resolvedIpv4: domain.resolvedIpv4,
      resolvedIpv6: domain.resolvedIpv6,
      expectedIpv4: domain.expectedIpv4,
      expectedIpv6: domain.expectedIpv6,
      httpReachable: domain.httpReachable,
      httpsReachable: domain.httpsReachable,
      lastVerifiedAt: domain.lastVerifiedAt,
      // Issuance lifecycle timestamps: issuanceRequestedAt records when SSL was
      // requested (button press); lastIssuedAt/lastRenewedAt are only set when a
      // REAL certificate is observed (§7). A request alone never sets lastIssuedAt.
      issuanceRequestedAt: domain.issuanceRequestedAt,
      lastIssuedAt: domain.lastIssuedAt,
      lastRenewedAt: domain.lastRenewedAt,
      lastError: domain.lastError,
    },
    certificate: {
      issuer: cert.issuer,
      serial: cert.serial,
      notBefore: cert.notBefore,
      notAfter: cert.notAfter,
      status: cert.status,
      // note: probe error is surfaced generically; never a stack trace.
      probe: cert.error ? 'unreachable' : 'ok',
    },
    proxy: {
      generatedPath: GENERATED_CADDYFILE_PATH,
      configPreview, // redacted, read-only
      readOnly: true,
    },
  });
}
