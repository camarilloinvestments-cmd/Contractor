-- Additive migration: track issuance request time separately from actual cert issuance.
-- issuanceRequestedAt is set when an operator requests issuance/reissue (ISSUING state).
-- lastIssuedAt / lastRenewedAt remain reserved for observed real certificate material.
ALTER TABLE "HostedDomain" ADD COLUMN IF NOT EXISTS "issuanceRequestedAt" TIMESTAMP(3);
