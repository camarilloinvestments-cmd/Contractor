// GitHub Releases client. GitHub is the software source of truth and the repo is
// PRIVATE, so all calls are authenticated server-side with a stored PAT. The
// token is never returned to the browser and never logged.
import { matchesChannel, isNewer, type ReleaseChannel } from './semver';

const GITHUB_API = 'https://api.github.com';

export interface GithubConfig {
  owner: string;
  repo: string;
  token: string | null;
  channel: ReleaseChannel;
}

export interface ReleaseAsset {
  name: string;
  size: number;
  downloadUrl: string; // API asset URL (works for private repos with auth)
  contentType: string;
}

export interface NormalizedRelease {
  tag: string;
  version: string; // tag with leading v stripped
  name: string;
  publishedAt: string | null;
  commit: string | null;
  prerelease: boolean;
  notes: string;
  assets: ReleaseAsset[];
  packageAsset: ReleaseAsset | null; // the .tar.gz app package
  manifestAsset: ReleaseAsset | null;
}

function headers(token: string | null): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'os1-fiber-track-pro-updater',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function normalize(r: any): NormalizedRelease {
  const tag = String(r.tag_name || '');
  const version = tag.replace(/^v/i, '');
  const assets: ReleaseAsset[] = (r.assets || []).map((a: any) => ({
    name: a.name,
    size: a.size,
    downloadUrl: a.url, // API url; requires Accept: application/octet-stream + auth to download
    contentType: a.content_type,
  }));
  const packageAsset = assets.find((a) => /\.tar\.gz$/i.test(a.name)) || null;
  const manifestAsset = assets.find((a) => /manifest\.json$/i.test(a.name)) || null;
  return {
    tag,
    version,
    name: r.name || tag,
    publishedAt: r.published_at || null,
    commit: r.target_commitish || null,
    prerelease: !!r.prerelease,
    notes: r.body || '',
    assets,
    packageAsset,
    manifestAsset,
  };
}

export async function listReleases(cfg: GithubConfig): Promise<NormalizedRelease[]> {
  const url = `${GITHUB_API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/releases?per_page=30`;
  const res = await fetch(url, { headers: headers(cfg.token), cache: 'no-store' });
  if (!res.ok) {
    const detail = res.status === 404
      ? 'Repository or releases not found (check owner/repo and that the token can read this private repo).'
      : res.status === 401 ? 'GitHub authentication failed (invalid or expired token).'
      : `GitHub API error ${res.status}.`;
    throw new Error(detail);
  }
  const data = await res.json();
  return (Array.isArray(data) ? data : []).map(normalize);
}

// Latest release on the configured channel that is strictly newer than currentVersion.
export async function findLatestUpdate(
  cfg: GithubConfig,
  currentVersion: string
): Promise<{ latest: NormalizedRelease | null; updateAvailable: boolean }> {
  const releases = await listReleases(cfg);
  const eligible = releases
    .filter((r) => matchesChannel(r.version, cfg.channel))
    .sort((a, b) => (isNewer(a.version, b.version) ? -1 : 1));
  const latest = eligible[0] || null;
  const updateAvailable = !!latest && isNewer(latest.version, currentVersion);
  return { latest, updateAvailable };
}

export async function testGithubConnection(cfg: GithubConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const url = `${GITHUB_API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
    const res = await fetch(url, { headers: headers(cfg.token), cache: 'no-store' });
    if (!res.ok) {
      return { ok: false, message: res.status === 404 ? 'Repository not found or token lacks access.' : `GitHub API error ${res.status}.` };
    }
    const repo = await res.json();
    return { ok: true, message: `Connected to ${repo.full_name}${repo.private ? ' (private)' : ''}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Connection failed.' };
  }
}

// Download a release asset (private-repo safe). Returns the raw bytes.
export async function downloadAsset(cfg: GithubConfig, asset: ReleaseAsset): Promise<Buffer> {
  const res = await fetch(asset.downloadUrl, {
    headers: { ...headers(cfg.token), Accept: 'application/octet-stream' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Asset download failed (${res.status}).`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
