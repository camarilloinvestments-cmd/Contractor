// Phase 2 — Email Provider Acceptance Harness.
//
// Repeatable, DB-free acceptance for the multi-provider outbound email system.
// It proves the parts that do NOT need a live SMTP server or database:
//
//   [FUNCTIONAL]  Exercises real code paths (provider registry, transport-mode
//                 -> nodemailer option mapping, OAuth2 option assembly, error
//                 categorization, secret masking) with no network/DB needed.
//   [STATIC]      Asserts a behavior is present in the shipped source (routes are
//                 ADMIN-gated; the public settings view exposes no ciphertext).
//   [LIVE]        Requires a live SMTP server + DB to exercise end-to-end (Test
//                 Connection, Send Test Email, real invoice/quote/estimate mail).
//                 These are reported as LIVE-REQUIRED, never asserted PASS.
//
// Run:  node_modules/.bin/tsx scripts/acceptance/email-provider-acceptance.ts
// Exit: non-zero if any FUNCTIONAL/STATIC check FAILS.
import fs from 'fs';
import path from 'path';

import {
  PROVIDER_PRESETS,
  TRANSPORT_MODES,
  AUTH_METHODS,
  getProviderPreset,
  isValidTransportMode,
  isValidAuthMethod,
  publicProviderRegistry,
} from '../../lib/email/providers';
import { buildTransport, resolveTransportMode, resolveAuthMethod, TransportConfigError } from '../../lib/email/transport';
import { categorizeEmailError } from '../../lib/email/errors';

const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0;
let fail = 0;
const live: string[] = [];

function ok(n: number, name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${String(n).padStart(2)}. ${name}${detail ? '  \u2014 ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${String(n).padStart(2)}. ${name}${detail ? '  \u2014 ' + detail : ''}`); }
}
function liveRequired(n: number, name: string, how: string) {
  live.push(`${String(n).padStart(2)}. ${name} \u2014 ${how}`);
  console.log(`LIVE  ${String(n).padStart(2)}. ${name}  \u2014 requires live target: ${how}`);
}
function read(rel: string): string { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

function main() {
  console.log('=== Phase 2 Email Provider Acceptance ===\n');

  // 1. All 13 required providers are present.
  {
    const required = ['m365', 'gmail', 'yahoo', 'icloud', 'zoho', 'fastmail', 'ses', 'sendgrid', 'mailgun', 'postmark', 'smtp2go', 'custom'];
    const keys = PROVIDER_PRESETS.map((p) => p.key);
    const missing = required.filter((k) => !keys.includes(k));
    ok(1, 'required provider presets present', missing.length === 0,
      missing.length ? `missing: ${missing.join(', ')}` : `${keys.length} providers`);
  }

  // 2. Transport modes are exactly the three explicit modes (no ambiguous boolean).
  ok(2, 'transport modes are STARTTLS / IMPLICIT_TLS / NONE',
    TRANSPORT_MODES.length === 3 && ['STARTTLS', 'IMPLICIT_TLS', 'NONE'].every((m) => (TRANSPORT_MODES as string[]).includes(m)),
    TRANSPORT_MODES.join(', '));

  // 3. Auth methods are PASSWORD and OAUTH2.
  ok(3, 'auth methods are PASSWORD / OAUTH2',
    AUTH_METHODS.length === 2 && ['PASSWORD', 'OAUTH2'].every((m) => (AUTH_METHODS as string[]).includes(m)),
    AUTH_METHODS.join(', '));

  // 4. M365 preset matches spec: smtp.office365.com / 587 / STARTTLS / OAuth2.
  {
    const p = getProviderPreset('m365');
    ok(4, 'M365 preset (smtp.office365.com:587 STARTTLS, OAuth2 supported)',
      !!p && p.host === 'smtp.office365.com' && p.port === 587 && p.transportMode === 'STARTTLS' && p.authMethods.includes('OAUTH2'),
      p ? `${p.host}:${p.port}/${p.transportMode}` : 'missing');
  }

  // 5. Gmail preset matches spec: smtp.gmail.com / 587 / STARTTLS.
  {
    const p = getProviderPreset('gmail');
    ok(5, 'Gmail preset (smtp.gmail.com:587 STARTTLS)',
      !!p && p.host === 'smtp.gmail.com' && p.port === 587 && p.transportMode === 'STARTTLS',
      p ? `${p.host}:${p.port}/${p.transportMode}` : 'missing');
  }

  // 6. SendGrid mandates the fixed username "apikey".
  {
    const p = getProviderPreset('sendgrid');
    ok(6, 'SendGrid fixed username "apikey"', !!p && p.fixedUsername === 'apikey', p?.fixedUsername ?? 'missing');
  }

  // 7. Validators accept valid values and reject junk.
  ok(7, 'transport/auth validators reject invalid values',
    isValidTransportMode('STARTTLS') && !isValidTransportMode('TLS') && isValidAuthMethod('OAUTH2') && !isValidAuthMethod('BASIC'));

  // 8. STARTTLS maps to secure:false + requireTLS:true.
  {
    const t = buildTransport(
      { host: 'smtp.x.com', port: 587, transportMode: 'STARTTLS', username: 'u', fromEmail: 'f@x.com' },
      { password: 'p' });
    const o = t.options as any;
    ok(8, 'STARTTLS -> {secure:false, requireTLS:true}', o.secure === false && o.requireTLS === true && t.mode === 'STARTTLS');
  }

  // 9. IMPLICIT_TLS maps to secure:true (and defaults port 465 when unset).
  {
    const t = buildTransport(
      { host: 'smtp.x.com', port: null, transportMode: 'IMPLICIT_TLS', username: 'u', fromEmail: 'f@x.com' },
      { password: 'p' });
    const o = t.options as any;
    ok(9, 'IMPLICIT_TLS -> {secure:true}, default port 465', o.secure === true && o.port === 465);
  }

  // 10. NONE maps to secure:false + ignoreTLS:true.
  {
    const t = buildTransport(
      { host: 'relay.internal', port: 25, transportMode: 'NONE', username: null, fromEmail: 'f@x.com' },
      {});
    const o = t.options as any;
    ok(10, 'NONE -> {secure:false, ignoreTLS:true}', o.secure === false && o.ignoreTLS === true);
  }

  // 11. Legacy fallback: no transportMode + secure=true resolves to IMPLICIT_TLS.
  ok(11, 'legacy secure=true -> IMPLICIT_TLS',
    resolveTransportMode({ host: 'h', port: 465, secure: true, username: 'u', fromEmail: 'f@x.com' }) === 'IMPLICIT_TLS'
    && resolveTransportMode({ host: 'h', port: 587, secure: false, username: 'u', fromEmail: 'f@x.com' }) === 'STARTTLS');

  // 12. OAuth2 assembles a nodemailer OAuth2 auth block; M365 gets a tenant accessUrl.
  {
    const t = buildTransport(
      { host: 'smtp.office365.com', port: 587, transportMode: 'STARTTLS', authMethod: 'OAUTH2',
        username: 'user@contoso.com', fromEmail: 'user@contoso.com', oauthClientId: 'cid', oauthTenantId: 'contoso.onmicrosoft.com' },
      { oauthClientSecret: 'sec', oauthRefreshToken: 'rt' });
    const auth = (t.options as any).auth;
    ok(12, 'OAuth2 auth block assembled with M365 tenant accessUrl',
      t.authMethod === 'OAUTH2' && auth?.type === 'OAuth2' && auth?.clientId === 'cid'
      && typeof auth?.accessUrl === 'string' && auth.accessUrl.includes('contoso.onmicrosoft.com'));
  }

  // 13. OAuth2 without a refresh token fails closed (config error, no silent send).
  {
    let threw = false;
    try {
      buildTransport(
        { host: 'smtp.gmail.com', port: 587, transportMode: 'STARTTLS', authMethod: 'OAUTH2',
          username: 'u@gmail.com', fromEmail: 'u@gmail.com', oauthClientId: 'cid' },
        { oauthClientSecret: 'sec' /* no refresh token */ });
    } catch (e) { threw = e instanceof TransportConfigError; }
    ok(13, 'OAuth2 missing refresh token throws TransportConfigError', threw);
  }

  // 14. PASSWORD auth with a username but no password fails closed.
  {
    let threw = false;
    try {
      buildTransport({ host: 'smtp.x.com', port: 587, transportMode: 'STARTTLS', username: 'u', fromEmail: 'f@x.com' }, {});
    } catch (e) { threw = e instanceof TransportConfigError; }
    ok(14, 'PASSWORD auth missing password throws TransportConfigError', threw);
  }

  // 15. Error categorization maps representative SMTP failures correctly.
  {
    const cases: [any, string][] = [
      [{ code: 'EAUTH', responseCode: 535, message: 'Invalid login' }, 'AUTH'],
      [{ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND smtp.x' }, 'DNS'],
      [{ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }, 'CONNECTION'],
      [{ code: 'ETIMEDOUT', message: 'timed out' }, 'TIMEOUT'],
      [{ code: 'ESOCKET', message: 'wrong version number' }, 'TLS'],
      [{ responseCode: 550, message: 'mailbox unavailable' }, 'RECIPIENT'],
      [{ responseCode: 421, message: 'too many messages' }, 'RATE_LIMIT'],
      [{ name: 'EncryptionKeyError', message: 'encryption key missing' }, 'ENCRYPTION_KEY'],
    ];
    const wrong = cases.filter(([err, cat]) => categorizeEmailError(err).category !== cat);
    ok(15, 'SMTP error categorization', wrong.length === 0,
      wrong.length ? `mismatched: ${wrong.map(([, c]) => c).join(', ')}` : `${cases.length} cases`);
  }

  // 16. Categorized messages are safe (never echo raw provider text/secrets).
  {
    const raw = 'AUTH failed for user secret-password-12345 at host';
    const cat = categorizeEmailError({ code: 'EAUTH', message: raw });
    ok(16, 'categorized message is safe (no raw echo)',
      !cat.message.includes('secret-password-12345') && !cat.message.includes(raw));
  }

  // 17. Public registry exposes no secret-bearing fields (notes prose may mention
  //     words like "app password"; we assert on the object KEYS, not free text).
  {
    const reg = publicProviderRegistry();
    const allowedKeys = new Set(['key', 'label', 'host', 'port', 'transportMode', 'authMethods', 'fixedUsername', 'hostEditable', 'notes']);
    const secretKeyRe = /(password|secret|token|credential|encrypted)/i;
    const leakedKeys = reg.flatMap((entry) => Object.keys(entry).filter((k) => !allowedKeys.has(k) || secretKeyRe.test(k)));
    ok(17, 'public provider registry exposes no secret-bearing fields',
      reg.length === PROVIDER_PRESETS.length && leakedKeys.length === 0,
      leakedKeys.length ? `unexpected keys: ${leakedKeys.join(', ')}` : `${reg.length} entries, keys clean`);
  }

  // 18. STATIC: settings public view exposes has* flags, never ciphertext.
  {
    const src = read('lib/email/settings.ts');
    const good = /hasPassword/.test(src) && /hasOauthClientSecret/.test(src) && /hasOauthRefreshToken/.test(src)
      && !/passwordEncrypted:\s*row\.passwordEncrypted/.test(src);
    ok(18, 'settings public view masks secrets (has* flags only)', good);
  }

  // 19. STATIC: email settings + verify routes are ADMIN-gated.
  {
    const route = read('app/api/settings/email/route.ts');
    const verify = read('app/api/settings/email/verify/route.ts');
    const test = read('app/api/settings/email/test/route.ts');
    const gated = (s: string) => /await\s+auth\(\)/.test(s) && /role\s*!==\s*'ADMIN'/.test(s);
    ok(19, 'email settings/verify/test routes are ADMIN-gated', gated(route) && gated(verify) && gated(test));
  }

  // 20. STATIC: mailer routes all outbound mail through the categorized sender.
  {
    const src = read('lib/email/mailer.ts');
    ok(20, 'mailer uses transport abstraction + categorized errors',
      /buildTransport as buildTransportOptions/.test(src) && /categorizeEmailError/.test(src) && /decryptEmailSecrets/.test(src));
  }

  // LIVE-only checks.
  liveRequired(21, 'Test Connection (verifyTransport) against a real SMTP server',
    'POST /api/settings/email/verify with saved settings; expect ok:true or a categorized error');
  liveRequired(22, 'Send Test Email end-to-end',
    'POST /api/settings/email/test; requires live SMTP + DB (EmailLog write)');
  liveRequired(23, 'Invoice/Quote/Estimate email uses the selected provider',
    'send a real invoice/quote/estimate; confirm delivery via the chosen provider and an EmailLog SENT row');

  console.log(`\n${pass} passed, ${fail} failed (non-live checks).`);
  if (live.length) {
    console.log(`\n${live.length} check(s) require a live SMTP server and/or live Postgres to fully validate:`);
    for (const l of live) console.log(`  \u2022 ${l}`);
  }
  if (fail > 0) process.exit(1);
}

main();
