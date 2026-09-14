-- Phase 2: multi-provider outbound email.
-- Additive, backward-compatible columns on EmailSettings. Existing rows keep
-- working via the application-layer legacy fallback (secure=true -> IMPLICIT_TLS,
-- otherwise STARTTLS; authMethod defaults to PASSWORD). OAuth2 secrets are stored
-- encrypted at rest (same scheme as passwordEncrypted) and are never returned to
-- clients in plaintext.
ALTER TABLE "EmailSettings" ADD COLUMN IF NOT EXISTS "provider" TEXT DEFAULT 'custom';
ALTER TABLE "EmailSettings" ADD COLUMN IF NOT EXISTS "transportMode" TEXT DEFAULT 'STARTTLS';
ALTER TABLE "EmailSettings" ADD COLUMN IF NOT EXISTS "authMethod" TEXT DEFAULT 'PASSWORD';
ALTER TABLE "EmailSettings" ADD COLUMN IF NOT EXISTS "oauthClientId" TEXT;
ALTER TABLE "EmailSettings" ADD COLUMN IF NOT EXISTS "oauthClientSecretEncrypted" TEXT;
ALTER TABLE "EmailSettings" ADD COLUMN IF NOT EXISTS "oauthRefreshTokenEncrypted" TEXT;
ALTER TABLE "EmailSettings" ADD COLUMN IF NOT EXISTS "oauthTenantId" TEXT;
