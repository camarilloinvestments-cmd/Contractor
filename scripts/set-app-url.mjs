#!/usr/bin/env node
// set-app-url.mjs — controlled canonical URL (NEXTAUTH_URL) management.
//
// Usage:  node scripts/set-app-url.mjs --status
//         node scripts/set-app-url.mjs --dry-run <hostname>
//         node scripts/set-app-url.mjs --apply   <hostname>
//         node scripts/set-app-url.mjs --rollback
//
// This helper is the ONLY thing that writes the canonical URL. It is invoked by
// the app's service layer (lib/domains/appurl.ts) via spawn() with a FIXED
// executable and a FIXED argument vector (shell:false) — no operator string is
// ever interpolated into a command line.
//
// Safety contract (§14):
//   * strictly validate the target hostname (inline; cannot import TS),
//   * BACK UP the previous config (mode 600, timestamped) before writing,
//   * write NEXTAUTH_URL=https://<host> to a PERSISTENT config file,
//   * re-read to VERIFY the write, self-restoring the backup on failure,
//   * --rollback restores the most recent backup,
//   * NEVER print NEXTAUTH_SECRET or any secret value,
//   * exit non-zero on any failure so the caller can surface a rollback.
//
// The config file lives on a PERSISTENT volume (default /app/data/app-url.env),
// overridable via APP_URL_CONFIG_PATH. It is a single-purpose env fragment that
// the container entrypoint sources to export NEXTAUTH_URL — it never contains
// secrets.
import { promises as fs } from 'fs';
import path from 'path';

const CONFIG_PATH = process.env.APP_URL_CONFIG_PATH || '/app/data/app-url.env';
const BACKUP_DIR = path.join(path.dirname(CONFIG_PATH), 'app-url-backups');

// Strict hostname validation — mirrors lib/domains/hostname.ts. Rejects schemes,
// ports, paths, spaces, shell metacharacters, wildcards, localhost, and IPs.
const FORBIDDEN = /[\s/:\\@?#%&'"`;|$(){}<>\[\]*!^~=+,]/;
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const RESERVED = new Set(['localhost', 'localdomain', 'local', 'invalid', 'example', 'test']);
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function validateHostname(input) {
  if (typeof input !== 'string') return null;
  let h = input.trim().toLowerCase();
  if (!h || h.length > 253) return null;
  if (h.endsWith('.')) h = h.slice(0, -1);
  if (FORBIDDEN.test(h)) return null;
  if (IPV4.test(h)) return null;
  if (h.includes(':')) return null; // IPv6 / port
  const labels = h.split('.');
  if (labels.length < 2) return null;
  if (RESERVED.has(h) || RESERVED.has(labels[labels.length - 1])) return null;
  for (const l of labels) {
    if (!LABEL.test(l)) return null;
  }
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/.test(tld)) return null;
  return h;
}

function die(msg) {
  // Never interpolate secret material. Callers scrub too, as defense in depth.
  process.stderr.write(`set-app-url: ${msg}\n`);
  process.exit(1);
}

async function readCurrent() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    const m = raw.match(/^NEXTAUTH_URL=(.*)$/m);
    return m ? m[1].trim() : null;
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
}

async function backup() {
  const current = await readCurrent();
  if (current === null) return null; // nothing to back up
  await fs.mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `app-url.${stamp}.env`);
  const raw = await fs.readFile(CONFIG_PATH, 'utf8');
  await fs.writeFile(dest, raw, { encoding: 'utf8', mode: 0o600 });
  return dest;
}

async function writeConfig(url) {
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  const contents =
    '# Managed by OS1 set-app-url.mjs — canonical application URL.\n' +
    '# Sourced by the container entrypoint to export NEXTAUTH_URL. No secrets here.\n' +
    `NEXTAUTH_URL=${url}\n`;
  await fs.writeFile(CONFIG_PATH, contents, { encoding: 'utf8', mode: 0o600 });
}

async function latestBackup() {
  try {
    const files = (await fs.readdir(BACKUP_DIR))
      .filter((f) => f.startsWith('app-url.') && f.endsWith('.env'))
      .sort();
    return files.length ? path.join(BACKUP_DIR, files[files.length - 1]) : null;
  } catch {
    return null;
  }
}

const mode = process.argv[2] || '';
const arg = process.argv[3] || '';

try {
  if (mode === '--status') {
    const current = await readCurrent();
    process.stdout.write(`current: ${current ?? '(unset)'}\n`);
    process.exit(0);
  }

  if (mode === '--rollback') {
    const bak = await latestBackup();
    if (!bak) die('no backup available to roll back to');
    const raw = await fs.readFile(bak, 'utf8');
    await fs.writeFile(CONFIG_PATH, raw, { encoding: 'utf8', mode: 0o600 });
    const restored = await readCurrent();
    process.stdout.write(`rolled back to: ${restored ?? '(unset)'}\n`);
    process.exit(0);
  }

  if (mode === '--dry-run' || mode === '--apply') {
    const host = validateHostname(arg);
    if (!host) die('invalid hostname');
    const url = `https://${host}`;
    const current = await readCurrent();

    if (mode === '--dry-run') {
      process.stdout.write(`preview: would set NEXTAUTH_URL to ${url}\n`);
      process.stdout.write(`previous: ${current ?? '(unset)'}\n`);
      process.exit(0);
    }

    // --apply: backup -> write -> verify -> self-restore on failure.
    const backupPath = await backup();
    try {
      await writeConfig(url);
      const readBack = await readCurrent();
      if (readBack !== url) throw new Error('verification mismatch after write');
    } catch (e) {
      // Self-restore so we never strand a broken canonical URL.
      if (backupPath) {
        try {
          const raw = await fs.readFile(backupPath, 'utf8');
          await fs.writeFile(CONFIG_PATH, raw, { encoding: 'utf8', mode: 0o600 });
        } catch {
          /* best effort */
        }
      } else {
        try { await fs.unlink(CONFIG_PATH); } catch { /* noop */ }
      }
      die(`write failed and was rolled back: ${e?.message ?? e}`);
    }
    process.stdout.write(`applied: NEXTAUTH_URL=${url}\n`);
    process.stdout.write(`previous: ${current ?? '(unset)'}\n`);
    if (backupPath) process.stdout.write(`backup: ${backupPath}\n`);
    process.exit(0);
  }

  die('usage: set-app-url.mjs --status | --dry-run <host> | --apply <host> | --rollback');
} catch (e) {
  die(`${e?.message ?? e}`);
}
