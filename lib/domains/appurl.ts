// Canonical application URL (NEXTAUTH_URL) change orchestration.
//
// Changing the canonical URL is done through a CONTROLLED mechanism, never by
// silently rewriting secrets. The actual file write/backup/rollback is performed
// by a restricted Node helper (scripts/set-app-url.mjs) invoked with a FIXED
// executable and a FIXED argument vector (spawn WITHOUT a shell) — no operator
// string is ever interpolated into a command line. The helper:
//   * validates the target hostname strictly,
//   * backs up the previous config (mode 600) before writing,
//   * writes NEXTAUTH_URL=https://<host> to the persisted config file,
//   * supports --dry-run (preview) and --rollback,
//   * never prints NEXTAUTH_SECRET or any secret value.
import { spawn } from 'child_process';
import path from 'path';
import { validateHostname } from './hostname';

export type AppUrlActionResult = {
  ok: boolean;
  action: 'preview' | 'apply' | 'rollback' | 'status';
  url?: string;
  previousUrl?: string;
  backupPath?: string;
  message: string;
};

const SCRIPT = path.join(process.cwd(), 'scripts', 'set-app-url.mjs');

function runHelper(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // Fixed executable + fixed argv; shell:false so no metacharacter is ever
    // interpreted. The only variable is the already-validated hostname.
    const child = spawn(process.execPath, [SCRIPT, ...args], { shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on('error', () => resolve({ code: 1, stdout, stderr: 'helper failed to start' }));
  });
}

function scrub(s: string): string {
  // Defense in depth: strip anything that looks like a secret from helper output
  // before it is ever surfaced. The helper already avoids printing secrets.
  return s
    .replace(/(NEXTAUTH_SECRET|AUTH_SECRET|APP_ENCRYPTION_KEY|PASSWORD|TOKEN)=\S+/gi, '$1=[REDACTED]')
    .trim();
}

/** Preview the canonical URL change without writing anything. */
export async function previewCanonicalUrl(hostname: string): Promise<AppUrlActionResult> {
  const v = validateHostname(hostname);
  if (!v.ok) return { ok: false, action: 'preview', message: v.reason };
  const r = await runHelper(['--dry-run', v.hostname]);
  return { ok: r.code === 0, action: 'preview', url: `https://${v.hostname}`, message: scrub(r.stdout || r.stderr) };
}

/**
 * Apply the canonical URL change: backup, write, verify. On any failure the
 * helper restores the backup itself; we surface a rollback result.
 */
export async function applyCanonicalUrl(hostname: string): Promise<AppUrlActionResult> {
  const v = validateHostname(hostname);
  if (!v.ok) return { ok: false, action: 'apply', message: v.reason };
  const r = await runHelper(['--apply', v.hostname]);
  return {
    ok: r.code === 0,
    action: 'apply',
    url: `https://${v.hostname}`,
    message: scrub(r.stdout || r.stderr),
  };
}

/** Roll back to the most recent backup of the canonical URL config. */
export async function rollbackCanonicalUrl(): Promise<AppUrlActionResult> {
  const r = await runHelper(['--rollback']);
  return { ok: r.code === 0, action: 'rollback', message: scrub(r.stdout || r.stderr) };
}

/** Read the currently configured canonical URL (never returns secrets). */
export async function statusCanonicalUrl(): Promise<AppUrlActionResult> {
  const r = await runHelper(['--status']);
  return { ok: r.code === 0, action: 'status', message: scrub(r.stdout || r.stderr) };
}
