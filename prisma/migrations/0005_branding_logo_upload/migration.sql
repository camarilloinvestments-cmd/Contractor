-- Workstream F: Branding image uploads
-- Additive, non-destructive. Adds uploaded-logo storage metadata to CompanyProfile.
-- Existing rows keep NULL for both columns (external logoUrl continues to work).

ALTER TABLE "CompanyProfile" ADD COLUMN     "logoStoragePath" TEXT;
ALTER TABLE "CompanyProfile" ADD COLUMN     "logoContentType" TEXT;
