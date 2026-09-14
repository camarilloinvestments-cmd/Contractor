// Central application version foundation (Phase 1 / v1.1.0).
// APP_VERSION is sourced from package.json so there is a single source of truth.
// Anything that needs to display or report the running version imports from here.
import pkg from '../package.json';

export const APP_VERSION: string = (pkg as { version?: string }).version ?? '0.0.0';

// Commit the running build was produced from. Baked in at image build time via
// the Dockerfile ARG/ENV APP_BUILD_SHA (docker-compose passes the deploy SHA).
// Falls back to a dev-time env var, else 'unknown' when running from source.
export const APP_BUILD_SHA: string =
  (process.env.APP_BUILD_SHA || process.env.NEXT_PUBLIC_APP_BUILD_SHA || 'unknown').trim() || 'unknown';

// Short 7-char commit for compact display in the operator Update Center.
export function getShortSha(sha: string = APP_BUILD_SHA): string {
  if (!sha || sha === 'unknown') return 'unknown';
  return sha.slice(0, 7);
}

// FIXED product identity. White-label deployments may show a custom company/brand
// name in the UI (CompanyProfile.companyName), but the underlying software product
// is always this and is never customer-editable.
export const PRODUCT_NAME = 'OS1 Fiber Track Pro';
export const PRODUCT_SLUG = 'os1-fiber-track-pro';
// Backward-compatible alias (previously the product name constant).
export const APP_NAME = PRODUCT_NAME;

// Build/runtime metadata helper used by the health endpoint and UI footer.
export function getVersionInfo() {
  return {
    name: PRODUCT_NAME,
    product: PRODUCT_NAME,
    version: APP_VERSION,
    commit: APP_BUILD_SHA,
    shortCommit: getShortSha(),
    node: process.version,
    environment: process.env.NODE_ENV ?? 'development',
  };
}
