// Explicit, fail-closed proxy config activation.
//
// This module replaces the previous "drop a file and let Caddy --watch pick it
// up" behaviour, which was fire-and-forget: a syntactically valid-to-us but
// operationally rejected config would silently fail to load while OS1 reported
// success. Here the flow is:
//
//   generate candidate  (caller: caddy.ts generateCaddyfile + validate)
//        -> read + retain the PREVIOUS on-disk config
//        -> atomically write the candidate (tmp file + rename, never partial)
//        -> ask Caddy's admin API to load/activate it
//        -> on ANY failure, atomically restore the previous config and report
//           PROXY_RELOAD_FAILED so the running config is never left broken.
//
// The Caddy admin endpoint is internal-only (bound inside the proxy container,
// reachable over the Docker network as http://proxy:2019); it is NEVER published
// to the host. The app talks to it over the internal network. There is no Docker
// socket mounted into the app.
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Internal Caddy admin endpoint. Empty string => deferred/dev mode: we still do
// the atomic file write (so a --watch or restart picks it up) but do not attempt
// a live admin reload. In the shipped compose this is set to http://proxy:2019.
export const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL || '';

// Default admin bind used when rendering the effective Caddyfile global block.
// Bound on all interfaces WITHIN the proxy container network namespace only; the
// port is never published to the host (see docker-compose).
export const DEFAULT_ADMIN_BIND = '0.0.0.0:2019';

/**
 * Atomically write `contents` to `target`: write to a temp file in the same
 * directory then rename() over the target. rename() within a filesystem is
 * atomic, so a reader (Caddy) never observes a partially written file.
 */
export async function writeFileAtomic(
  target: string,
  contents: string,
  mode = 0o644,
): Promise<void> {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.writeFile(tmp, contents, { encoding: 'utf8', mode });
    await fs.rename(tmp, target);
  } catch (err) {
    // Best-effort cleanup of the temp file on failure.
    try {
      await fs.unlink(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/**
 * Build the effective top-level Caddyfile that the proxy runs. The generated
 * per-site config lives in /caddy-generated/*.caddy and is pulled in via import.
 * The ACME email line is emitted ONLY when a non-empty address is supplied —
 * Caddy's caddyfile adapter rejects `email` with no argument, which would break
 * startup. The admin endpoint is declared so the app can reload via its API.
 */
export function buildEffectiveCaddyfile(opts?: {
  acmeEmail?: string | null;
  adminBind?: string;
  importGlob?: string;
}): string {
  const adminBind = (opts?.adminBind || DEFAULT_ADMIN_BIND).trim();
  const importGlob = (opts?.importGlob || '/caddy-generated/*.caddy').trim();
  const email = (opts?.acmeEmail || '').trim();

  const globalLines: string[] = [`\tadmin ${adminBind}`];
  if (email) globalLines.push(`\temail ${email}`);

  return (
    '# Effective Caddyfile rendered by OS1 proxy entrypoint — DO NOT EDIT BY HAND.\n' +
    '{\n' +
    globalLines.join('\n') +
    '\n}\n\n' +
    `import ${importGlob}\n`
  );
}

export type ReloadResult = { ok: true } | { ok: false; reason: string };

/**
 * Ask Caddy to load a full Caddyfile document via its admin API. POSTs the
 * Caddyfile text to `${adminUrl}/load` with Content-Type: text/caddyfile, which
 * makes Caddy adapt + validate + activate it in one atomic operation. A non-2xx
 * response (or a network/timeout error) means the RUNNING config is unchanged —
 * this is the fail-closed guarantee we rely on.
 */
export async function caddyAdminReload(
  adminUrl: string,
  caddyfileText: string,
  timeoutMs = 15_000,
): Promise<ReloadResult> {
  if (!adminUrl) return { ok: false, reason: 'no admin url' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${adminUrl.replace(/\/$/, '')}/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/caddyfile' },
      body: caddyfileText,
      signal: controller.signal,
    });
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, reason: `admin load returned ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'admin load failed' };
  } finally {
    clearTimeout(timer);
  }
}

export type ApplyResult =
  | { ok: true; reloaded: boolean }
  | { ok: false; reason: string };

/**
 * Apply a generated per-site config file with full fail-closed semantics:
 *
 *   1. Read and retain the previous on-disk contents (if any).
 *   2. Atomically write the candidate to `targetPath`.
 *   3. If an admin URL is configured, ask Caddy to load the EFFECTIVE Caddyfile
 *      (global block + import of the generated dir). On success we're done.
 *   4. On ANY reload failure, atomically restore the previous contents (or
 *      remove the file if there was none) and return PROXY_RELOAD_FAILED-style
 *      failure so the caller never reports a successful activation.
 *
 * When no admin URL is configured (dev / deferred), we still perform the atomic
 * write and return { ok:true, reloaded:false } — the file is valid and will be
 * consumed on the next proxy (re)start. Callers decide whether that is
 * acceptable for their environment.
 */
export async function applyGeneratedConfig(opts: {
  targetPath: string;
  candidate: string;
  adminUrl?: string;
  acmeEmail?: string | null;
  mode?: number;
  reloadFn?: (adminUrl: string, caddyfileText: string) => Promise<ReloadResult>;
}): Promise<ApplyResult> {
  const { targetPath, candidate } = opts;
  const adminUrl = opts.adminUrl ?? CADDY_ADMIN_URL;
  const reloadFn = opts.reloadFn ?? ((u, t) => caddyAdminReload(u, t));

  // 1. Retain previous contents (null => file did not exist).
  let previous: string | null = null;
  try {
    previous = await fs.readFile(targetPath, 'utf8');
  } catch {
    previous = null;
  }

  // 2. Atomically write the candidate.
  try {
    await writeFileAtomic(targetPath, candidate, opts.mode ?? 0o644);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'atomic write failed' };
  }

  // 3. No admin endpoint configured => deferred activation (dev). File is staged.
  if (!adminUrl) {
    return { ok: true, reloaded: false };
  }

  // 4. Attempt the live reload of the effective config.
  const effective = buildEffectiveCaddyfile({ acmeEmail: opts.acmeEmail });
  const reloaded = await reloadFn(adminUrl, effective);
  if (reloaded.ok) {
    return { ok: true, reloaded: true };
  }

  // 5. Fail-closed: restore the previous config atomically.
  try {
    if (previous === null) {
      await fs.unlink(targetPath).catch(() => {});
    } else {
      await writeFileAtomic(targetPath, previous, opts.mode ?? 0o644);
    }
  } catch {
    // If restore itself fails we still report the reload failure below; the
    // running Caddy config is unchanged regardless (admin load is atomic).
  }
  return { ok: false, reason: reloaded.reason };
}

// Exposed for tests/harness: a stable temp dir under the OS tmp location.
export function tmpConfigDir(): string {
  return path.join(os.tmpdir(), 'os1-caddy-reload');
}
