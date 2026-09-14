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
  // The URL persisted to the config file (staged). May differ from `active`
  // until the app process is restarted.
  configured?: string | null;
  // The URL the RUNNING process is actually using (process.env.NEXTAUTH_URL).
  active?: string | null;
  // True when a persisted change has NOT yet taken effect in the running
  // process — i.e. a controlled restart is required to activate it. A file
  // write alone must NEVER be reported as ACTIVE.
  pendingRestart?: boolean;
  message: string;
};

// Extract the first https URL from helper output (used to read the configured
// canonical URL back without ever touching secrets).
function firstHttpsUrl(s: string): string | null {
  const m = s.match(/https:\/\/[A-Za-z0-9.-]+/);
  return m ? m[0] : null;
}

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
  const configured = r.code === 0 ? `https://${v.hostname}` : null;
  const active = process.env.NEXTAUTH_URL || null;
  // A successful write stages the change; it only becomes ACTIVE after a
  // controlled restart (scripts/apply-canonical-url.sh). Never claim ACTIVE here.
  const pendingRestart = r.code === 0 && configured !== active;
  const baseMsg = scrub(r.stdout || r.stderr);
  return {
    ok: r.code === 0,
    action: 'apply',
    url: `https://${v.hostname}`,
    configured,
    active,
    pendingRestart,
    message:
      r.code === 0 && pendingRestart
        ? `${baseMsg}\nCanonical URL staged. Restart the app to activate it.`.trim()
        : baseMsg,
  };
}

/** Roll back to the most recent backup of the canonical URL config. */
export async function rollbackCanonicalUrl(): Promise<AppUrlActionResult> {
  const r = await runHelper(['--rollback']);
  return { ok: r.code === 0, action: 'rollback', message: scrub(r.stdout || r.stderr) };
}

/**
 * Read the canonical URL state (never returns secrets). Distinguishes the
 * CONFIGURED (persisted/staged) URL from the ACTIVE URL the running process is
 * actually serving, and reports pendingRestart when they differ so the UI can
 * show ISSUING/STAGED rather than falsely reporting ACTIVE on a mere file write.
 */
export async function statusCanonicalUrl(): Promise<AppUrlActionResult> {
  const r = await runHelper(['--status']);
  const message = scrub(r.stdout || r.stderr);
  const configured = firstHttpsUrl(message);
  const active = process.env.NEXTAUTH_URL || null;
  const pendingRestart = !!configured && configured !== active;
  return {
    ok: r.code === 0,
    action: 'status',
    configured,
    active,
    pendingRestart,
    message,
  };
}
