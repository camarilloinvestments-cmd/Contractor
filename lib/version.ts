// Central application version foundation (Phase 1 / v1.1.0).
// APP_VERSION is sourced from package.json so there is a single source of truth.
// Anything that needs to display or report the running version imports from here.
import pkg from '../package.json';

export const APP_VERSION: string = (pkg as { version?: string }).version ?? '0.0.0';
export const APP_NAME = 'FiberTrack Pro';

// Build/runtime metadata helper used by the health endpoint and UI footer.
export function getVersionInfo() {
  return {
    name: APP_NAME,
    version: APP_VERSION,
    node: process.version,
    environment: process.env.NODE_ENV ?? 'development',
  };
}
