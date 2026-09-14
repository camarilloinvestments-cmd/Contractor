-- Domain & SSL (Settings → Domain & SSL).
-- Additive: creates the HostedDomain table only. No existing table is touched,
-- so this is safe on existing databases with zero data loss. Status columns are
-- TEXT (String) to match the existing String-status convention and avoid new
-- enum types. No certificate PRIVATE KEY material is ever stored here.
CREATE TABLE IF NOT EXISTS "HostedDomain" (
    "id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "displayName" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "dnsStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "resolvedIpv4" TEXT,
    "resolvedIpv6" TEXT,
    "expectedIpv4" TEXT,
    "expectedIpv6" TEXT,
    "httpReachable" BOOLEAN,
    "httpsReachable" BOOLEAN,
    "sslEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sslStatus" TEXT NOT NULL DEFAULT 'NONE',
    "certificateIssuer" TEXT,
    "certificateSerial" TEXT,
    "certificateNotBefore" TIMESTAMP(3),
    "certificateNotAfter" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "lastIssuedAt" TIMESTAMP(3),
    "lastRenewedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HostedDomain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "HostedDomain_hostname_key" ON "HostedDomain"("hostname");
CREATE INDEX IF NOT EXISTS "HostedDomain_status_idx" ON "HostedDomain"("status");
CREATE INDEX IF NOT EXISTS "HostedDomain_isPrimary_idx" ON "HostedDomain"("isPrimary");
