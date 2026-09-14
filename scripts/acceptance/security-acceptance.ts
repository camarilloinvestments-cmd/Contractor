// Section M — Security Acceptance Harness.
//
// Repeatable, automated security acceptance for the FiberTrack remediation.
// It runs the 22 required checks. Each check is one of:
//
//   [FUNCTIONAL]  Exercises real code paths (crypto verification, archive
//                 inspection, RBAC decision logic) with no DB/server needed.
//   [STATIC]      Asserts the guard/behavior is present in the shipped source
//                 (the route calls auth() + the correct role gate; the schema
//                 has no PAN/CVV columns; no Abacus runtime script is injected).
//   [LIVE]        Requires a running server and/or live Postgres to exercise
//                 end-to-end. These are NOT asserted as PASS here — they are
//                 reported as LIVE-REQUIRED with the exact command/condition an
//                 operator must run. This keeps the harness honest: it never
//                 marks a DB/server-dependent behavior "passed" without a live
//                 target.
//
// Run:  node_modules/.bin/tsx scripts/acceptance/security-acceptance.ts
// Exit: non-zero if any FUNCTIONAL/STATIC check FAILS. LIVE-REQUIRED items do
//       not fail the run but are listed so they are never silently skipped.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';

import { canManage, isAdmin } from '../../lib/rbac';
import { verifyPackage, sha256Hex, type ReleaseManifest } from '../../lib/updates/manifest';
import { inspectGzipTar } from '../../lib/updates/archive';

const ROOT = path.resolve(__dirname, '..', '..');

let pass = 0;
let fail = 0;
const live: string[] = [];

function ok(n: number, name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${String(n).padStart(2)}. ${name}${detail ? '  — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${String(n).padStart(2)}. ${name}${detail ? '  — ' + detail : ''}`); }
}
function liveRequired(n: number, name: string, how: string) {
  live.push(`${String(n).padStart(2)}. ${name} — ${how}`);
  console.log(`LIVE  ${String(n).padStart(2)}. ${name}  — requires live target: ${how}`);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function exists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel));
}

// A route file "guards mutations" if it calls auth()/requireAuth and contains a
// role gate (canManage / requireManage / requireAdmin / requireRole / an
// explicit role !== check) that returns 401/403.
function hasAuthCall(src: string): boolean {
  return /await\s+auth\(\)/.test(src) || /require(Auth|Manage|Admin|Role)\s*\(/.test(src);
}
function hasRoleGate(src: string): boolean {
  return /canManage\s*\(/.test(src)
    || /require(Manage|Admin|Role)\s*\(/.test(src)
    || /role\s*!==\s*'ADMIN'/.test(src)
    || /role\s*===\s*'FIELD_WORKER'/.test(src)
    || /isAdmin\s*\(/.test(src);
}

// ---- tar builder (for test 17; mirrors update-archive-acceptance) ----
const BLOCK = 512;
function octal(nn: number, len: number) { return nn.toString(8).padStart(len - 1, '0') + '\0'; }
function tarHeader(name: string, typeflag: string, size: number, linkname = '') {
  const b = Buffer.alloc(BLOCK, 0);
  b.write(name.slice(0, 100), 0, 'utf8');
  b.write('0000644\0', 100); b.write('0000000\0', 108); b.write('0000000\0', 116);
  b.write(octal(size, 12), 124); b.write(octal(Math.floor(Date.now() / 1000), 12), 136);
  b.write(typeflag, 156);
  if (linkname) b.write(linkname.slice(0, 100), 157, 'utf8');
  b.write('ustar\0', 257); b.write('00', 263);
  b.write('        ', 148);
  let sum = 0; for (let i = 0; i < BLOCK; i++) sum += b[i];
  b.write(octal(sum, 8).slice(0, 6) + '\0 ', 148);
  return b;
}
function tarEntry(name: string, typeflag = '0', content = '', linkname = '') {
  const data = Buffer.from(content, 'utf8');
  const h = tarHeader(name, typeflag, typeflag === '5' ? 0 : data.length, linkname);
  const pad = data.length % BLOCK === 0 ? 0 : BLOCK - (data.length % BLOCK);
  return Buffer.concat([h, data, Buffer.alloc(pad, 0)]);
}
function tarGz(...parts: Buffer[]) {
  return zlib.gzipSync(Buffer.concat([...parts, Buffer.alloc(BLOCK * 2, 0)]));
}

function main() {
  console.log('=== Section M — Security Acceptance Harness ===\n');

  // 1. No hidden/default ADMIN accounts.
  //    bootstrap-admin.ts must be env-driven (no hardcoded creds); safe-seed.ts
  //    must not create an admin/role/password.
  {
    const boot = read('scripts/bootstrap-admin.ts');
    const seed = exists('scripts/safe-seed.ts') ? read('scripts/safe-seed.ts') : '';
    const bootEnvDriven = /process\.env\.ADMIN_EMAIL/.test(boot) && /randomBytes/.test(boot);
    const bootNoHardcodedPw = !/(password|passwordHash)\s*[:=]\s*['"][^'"]{6,}['"]/i.test(boot);
    const seedNoAdmin = !/role\s*[:=]\s*['"]?ADMIN/i.test(seed) && !/passwordHash/i.test(seed);
    ok(1, 'no hidden/default ADMIN accounts', bootEnvDriven && bootNoHardcodedPw && seedNoAdmin,
      'bootstrap env-driven + generated pw; seed creates no admin');
  }

  // 2. No Abacus runtime (no injected appllm/abacus script in the app shell).
  {
    const layout = read('app/layout.tsx');
    const noScript = !/appllm|apps\.abacus/i.test(layout);
    ok(2, 'no Abacus runtime injected in app shell', noScript,
      'app/layout.tsx contains no appllm/abacus script tag');
  }

  // 3. Public signup disabled (no signup/register route handler exists).
  {
    const signupRoutes = [
      'app/api/auth/signup/route.ts',
      'app/api/auth/register/route.ts',
      'app/api/signup/route.ts',
      'app/api/register/route.ts',
      'app/api/users/register/route.ts',
    ].filter(exists);
    ok(3, 'public signup disabled', signupRoutes.length === 0,
      'no signup/register route handler present');
  }

  // 4. Anonymous privileged APIs rejected.
  //    Every mutating/privileged route calls auth() (or a require* helper).
  {
    const privileged = [
      'app/api/jobs/route.ts', 'app/api/invoices/route.ts', 'app/api/payouts/route.ts',
      'app/api/prime-contractors/route.ts', 'app/api/prime-contractors/[id]/rates/route.ts',
      'app/api/dashboard/route.ts', 'app/api/reports/route.ts', 'app/api/api-keys/route.ts',
      'app/api/users/route.ts', 'app/api/projects/route.ts', 'app/api/price-books/route.ts',
    ];
    const missing = privileged.filter((r) => !hasAuthCall(read(r)));
    ok(4, 'anonymous privileged APIs rejected', missing.length === 0,
      missing.length ? `unguarded: ${missing.join(', ')}` : `${privileged.length} privileged routes require auth`);
    liveRequired(4, 'anonymous privileged APIs rejected (end-to-end HTTP 401)',
      'curl each route without a session cookie against a running server; expect HTTP 401');
  }

  // 5. FIELD_WORKER cannot list global jobs.
  {
    const src = read('app/api/jobs/route.ts');
    const restricts = /role\s*===\s*'FIELD_WORKER'/.test(src) && /assigned|assignedUserId|workerId|tasks/i.test(src);
    ok(5, 'FIELD_WORKER cannot list global jobs', restricts,
      'jobs GET scopes FIELD_WORKER to assigned work orders only');
  }

  // 6. FIELD_WORKER cannot access arbitrary jobs.
  {
    const src = read('app/api/jobs/[id]/route.ts');
    const scoped = /FIELD_WORKER/.test(src) || /assigned/i.test(src) || /canManage|requireManage/.test(src);
    ok(6, 'FIELD_WORKER cannot access arbitrary jobs', scoped,
      'jobs/[id] enforces assignment/role scope');
    liveRequired(6, 'FIELD_WORKER cannot access arbitrary jobs (end-to-end)',
      'GET /api/jobs/<other-worker-job-id> as FIELD_WORKER against a running server; expect 403/404');
  }

  // 7. Worker cannot alter financial rates.
  {
    const src = read('app/api/prime-contractors/[id]/rates/route.ts');
    ok(7, 'worker cannot alter financial rates', hasRoleGate(src) && /403/.test(src),
      'rates POST/PATCH gated by canManage → 403');
  }

  // 8. Worker cannot create invoices.
  {
    const src = read('app/api/invoices/route.ts');
    ok(8, 'worker cannot create invoices', /canManage/.test(src) && /403/.test(src),
      'invoices POST gated by canManage → 403');
  }

  // 9. Worker cannot create/update payouts.
  {
    const list = read('app/api/payouts/route.ts');
    const one = exists('app/api/payouts/[id]/route.ts') ? read('app/api/payouts/[id]/route.ts') : '';
    ok(9, 'worker cannot create/update payouts', hasRoleGate(list) && (one === '' || hasRoleGate(one)),
      'payouts POST + [id] mutations gated by canManage');
  }

  // 10. Worker cannot access global financial dashboard/reports.
  {
    const dash = read('app/api/dashboard/route.ts');
    const rep = read('app/api/reports/route.ts');
    const gated = /canManage/.test(dash) && /403/.test(dash) && /canManage/.test(rep) && /403/.test(rep);
    ok(10, 'worker cannot access global financial dashboard', gated,
      'dashboard + reports GET gated by canManage → 403');
  }

  // 11. Worker cannot mutate Prime Contractors.
  {
    const src = read('app/api/prime-contractors/route.ts');
    ok(11, 'worker cannot mutate Prime Contractors', /canManage/.test(src) && /403/.test(src),
      'prime-contractors POST gated by canManage → 403');
  }

  // 12. PROJECT_MANAGER cannot use ADMIN-only security APIs.
  {
    const adminOnly = [
      'app/api/api-keys/route.ts',
      'app/api/system/updates/settings/route.ts',
      'app/api/system/devices/route.ts',
    ].filter(exists);
    const enforced = adminOnly.filter((r) => {
      const s = read(r);
      return /role\s*!==\s*'ADMIN'/.test(s) || /requireAdmin\s*\(/.test(s) || /isAdmin\s*\(/.test(s);
    });
    ok(12, 'PROJECT_MANAGER cannot use ADMIN-only security APIs', enforced.length === adminOnly.length,
      `${enforced.length}/${adminOnly.length} ADMIN-only routes enforce ADMIN role`);
    // Functional: RBAC decision logic — PM is not admin, worker cannot manage.
    ok(12.1 as unknown as number, 'RBAC logic: PM/worker denied admin, worker denied manage',
      isAdmin('ADMIN') && !isAdmin('PROJECT_MANAGER') && !isAdmin('FIELD_WORKER')
      && canManage('ADMIN') && canManage('PROJECT_MANAGER') && !canManage('FIELD_WORKER'),
      'canManage/isAdmin enforce the intended matrix');
  }

  // 13. Deactivated mobile account immediately returns 401.
  {
    const src = read('lib/mobile/auth.ts');
    const checksActive = /status\s*!==\s*'ACTIVE'/.test(src) && /401/.test(src);
    ok(13, 'deactivated mobile account returns 401', checksActive,
      'mobile session verify rejects non-ACTIVE user/device with 401');
    liveRequired(13, 'deactivated mobile account returns 401 (end-to-end)',
      'deactivate a user, then call /api/mobile/me with their token against a running server; expect 401');
  }

  // ---- 14/15/16/17: functional crypto + archive verification (no DB) ----
  const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pubPem = kp.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const body = Buffer.from('release-payload-bytes', 'utf8');
  const baseManifest: ReleaseManifest = {
    version: '9.9.9', filename: 'pkg.tgz', sha256: sha256Hex(body),
    signatureAlgorithm: 'RSA-SHA256',
  };
  function sign(m: ReleaseManifest): string {
    const { signature, signatureAlgorithm, ...rest } = m;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(rest).sort()) sorted[k] = (rest as Record<string, unknown>)[k];
    const data = Buffer.from(JSON.stringify(sorted), 'utf8');
    const s = crypto.createSign('RSA-SHA256'); s.update(data); s.end();
    return s.sign(kp.privateKey).toString('base64');
  }

  // 14. Unsigned update rejected (signature required, none present).
  {
    const r = verifyPackage(body, { ...baseManifest }, { publicKeyPem: pubPem, requireSignature: true });
    ok(14, 'unsigned update rejected', r.ok === false && r.signatureOk === false,
      'verifyPackage rejects manifest with no signature when required');
  }

  // 15. Tampered update rejected (payload bytes altered → checksum mismatch).
  {
    const signed = { ...baseManifest, signature: sign(baseManifest) };
    const tampered = Buffer.from('release-payload-bytes-TAMPERED', 'utf8');
    const r = verifyPackage(tampered, signed, { publicKeyPem: pubPem, requireSignature: true });
    ok(15, 'tampered update rejected', r.ok === false && r.checksumOk === false,
      'verifyPackage rejects payload whose SHA-256 no longer matches the manifest');
  }

  // 16. Invalid-signature update rejected (signature present but forged).
  {
    const forged = { ...baseManifest, signature: Buffer.from('not-a-real-signature').toString('base64') };
    const r = verifyPackage(body, forged, { publicKeyPem: pubPem, requireSignature: true });
    ok(16, 'invalid-signature update rejected', r.ok === false && r.signatureOk === false,
      'verifyPackage rejects a manifest signature that does not verify against the pinned key');
  }

  // 17. Unsafe archives rejected (absolute path, traversal, symlink, special, multi-root).
  {
    const clean = inspectGzipTar(tarGz(tarEntry('app/', '5'), tarEntry('app/index.js', '0', 'x'))).ok;
    const abs = !inspectGzipTar(tarGz(tarEntry('app/', '5'), tarEntry('/etc/passwd', '0', 'x'))).ok;
    const trav = !inspectGzipTar(tarGz(tarEntry('app/', '5'), tarEntry('app/../../x', '0', 'x'))).ok;
    const sym = !inspectGzipTar(tarGz(tarEntry('app/', '5'), tarEntry('app/l', '2', '', '/etc/passwd'))).ok;
    const dev = !inspectGzipTar(tarGz(tarEntry('app/', '5'), tarEntry('app/dev', '3', ''))).ok;
    const multi = !inspectGzipTar(tarGz(tarEntry('app/', '5'), tarEntry('other/', '5'), tarEntry('other/x', '0', 'x'))).ok;
    ok(17, 'unsafe archives rejected', clean && abs && trav && sym && dev && multi,
      'inspector accepts clean single-root, rejects abs/traversal/symlink/special/multi-root');
  }

  // 18. PAN/CVV not persisted.
  {
    const schema = read('prisma/schema.prisma');
    const noPanColumns = !/\b(pan|cvv|cardNumber|cardCvv|fullCard|cardPan)\b/i.test(schema);
    const onlyLast4 = /cardLast4/.test(schema);
    const ippay = read('lib/payments/ippay.ts');
    // cardNumber/cardCvv may appear only transiently to build the gateway request;
    // the only value written to the DB record must be cardLast4.
    const persistsOnlyLast4 = /cardLast4:\s*last4/.test(ippay) && !/cardNumber:\s*(req\.)?cardNumber/.test(ippay) && !/cardCvv:\s*(req\.)?cardCvv/.test(ippay);
    ok(18, 'PAN/CVV not persisted', noPanColumns && onlyLast4 && persistsOnlyLast4,
      'schema stores only cardLast4; payments code never persists full PAN/CVV');
  }

  // 19. TypeScript passes.
  liveRequired(19, 'TypeScript passes',
    'run: rm -rf .build/types .next/types .next/dev/types && node_modules/.bin/tsc -p tsconfig.json --noEmit --skipLibCheck (expect EXIT 0)');

  // 20. Production build passes.
  liveRequired(20, 'production build passes',
    'run: yarn build (Next.js production build; expect success). Requires build toolchain + env');

  // 21. No browser/runtime Abacus traffic.
  {
    // Static side already asserted in (2). The runtime side (no network beacons
    // to Abacus while the app runs) requires a running browser session.
    const layout = read('app/layout.tsx');
    ok(21, 'no browser/runtime Abacus traffic (static: no injected client script)',
      !/appllm|apps\.abacus/i.test(layout),
      'no Abacus client script is shipped in the app shell');
    liveRequired(21, 'no browser/runtime Abacus traffic (network capture)',
      'load the running app and confirm no network requests to apps.abacus.ai / appllm in DevTools/Network');
  }

  // 22. Health endpoint healthy.
  {
    const src = read('app/api/health/route.ts');
    const shaped = /status:\s*healthy\s*\?\s*'ok'/.test(src) && /SELECT 1/.test(src) && /503/.test(src);
    ok(22, 'health endpoint present & correctly shaped', shaped,
      'GET /api/health returns {status} and 200/503 on DB probe');
    liveRequired(22, 'health endpoint healthy (end-to-end)',
      'GET /api/health against a running server with live DB; expect HTTP 200 and status:"ok"');
  }

  console.log(`\n${pass} passed, ${fail} failed (non-live checks).`);
  if (live.length) {
    console.log(`\n${live.length} check(s) require a live server and/or live Postgres to fully validate:`);
    for (const l of live) console.log(`  • ${l}`);
  }
  if (fail > 0) process.exit(1);
}

main();
