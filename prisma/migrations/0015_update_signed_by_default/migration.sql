-- Section G hardening: update packages must be signed by default.
-- Flip the column default so freshly-created settings rows require a signature.
-- (Existing rows are intentionally left untouched to avoid surprising an
--  operator mid-flight; the application layer enforces signed-by-default via
--  resolveVerificationPolicy regardless of this stored value.)
ALTER TABLE "UpdateSettings" ALTER COLUMN "requireSignature" SET DEFAULT true;
