-- v1.2.0 Workstream A: rename the default product identity.
--
-- The FIXED product identity ("OS1 Fiber Track Pro") lives in application code
-- (lib/version.ts) and is not stored in the database. The CompanyProfile.companyName
-- column is the WHITE-LABEL brand a deployment may customize; here we only:
--   1. update its column DEFAULT for new installs, and
--   2. rewrite rows that still hold the OLD default verbatim (i.e. never customized).
-- Rows a deployment has customized to any other value are left untouched.
-- This change is non-destructive (a text default + targeted value update).

-- AlterColumn default
ALTER TABLE "CompanyProfile" ALTER COLUMN "companyName" SET DEFAULT 'OS1 Fiber Track Pro';

-- Data migration: only rows still on the untouched old default.
UPDATE "CompanyProfile" SET "companyName" = 'OS1 Fiber Track Pro' WHERE "companyName" = 'FiberTrack Pro';
