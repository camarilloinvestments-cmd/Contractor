// Minimal semantic-version comparison supporting pre-release tags
// (e.g. 1.2.0-rc.1 < 1.2.0). Not a full spec implementation, but enough for
// release-channel ordering used by the update center.

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[]; // empty for a stable release
  raw: string;
}

export function parseVersion(input: string): ParsedVersion | null {
  const raw = input.trim().replace(/^v/i, '');
  const m = raw.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
    prerelease: m[4] ? m[4].split('.') : [],
    raw,
  };
}

function cmpIdentifiers(a: string, b: string): number {
  const an = /^\d+$/.test(a);
  const bn = /^\d+$/.test(b);
  if (an && bn) return parseInt(a, 10) - parseInt(b, 10);
  if (an) return -1; // numeric identifiers have lower precedence than alphanumeric
  if (bn) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// Returns negative if a < b, 0 if equal, positive if a > b.
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  // A version WITHOUT prerelease outranks one WITH prerelease.
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;
  const len = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const ai = pa.prerelease[i];
    const bi = pb.prerelease[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    const c = cmpIdentifiers(ai, bi);
    if (c !== 0) return c;
  }
  return 0;
}

export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

export type ReleaseChannel = 'STABLE' | 'RC' | 'BETA';

// Whether a version string belongs to the requested channel.
// STABLE = no prerelease tag; RC = contains 'rc'; BETA = contains 'beta'.
export function matchesChannel(version: string, channel: ReleaseChannel): boolean {
  const p = parseVersion(version);
  if (!p) return false;
  const pre = p.prerelease.join('.').toLowerCase();
  if (channel === 'STABLE') return p.prerelease.length === 0;
  if (channel === 'RC') return p.prerelease.length === 0 || pre.includes('rc');
  // BETA channel accepts everything (beta, rc, and stable).
  return true;
}
