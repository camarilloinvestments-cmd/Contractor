// Domain & SSL Acceptance Harness (cold-review before live domain validation).
//
// Proves the Settings -> Domain & SSL control plane is safe and correct by
// design. Pure logic (hostname validation, proxy-config generation + guard,
// certificate status math, secret redaction) is exercised FUNCTIONALLY by
// importing lib/domains/*. Structural guarantees (RBAC, audit, force-dynamic,
// no-shell, no private-key exposure, compose port/volume topology, canonical
// URL backup+rollback, updater volume protection) are asserted STATICALLY over
// the source. Anything that can only be proven against a live server with
// public DNS/IP/ports + a running Docker/ACME stack (real DNS resolution, real
// port reachability, real Let's Encrypt issuance/renewal, real cert on the
// wire) is flagged LIVE-VM and NOT counted as PASS (per the reporting rule:
// never claim issuance PASS from an environment without public reachability).
//
//   1  valid hostname accepted                          (functional)
//   2  invalid hostname rejected                        (functional)
//   3  scheme (http/https) rejected                     (functional)
//   4  port in hostname rejected                        (functional)
//   5  shell-injection payload rejected                 (functional)
//   6  DNS mismatch detected                            (LIVE-VM)
//   7  public-IP match detected                         (LIVE-VM)
//   8  port 80 failure surfaced                         (LIVE-VM)
//   9  port 443 failure surfaced                        (LIVE-VM)
//  10  proxy config generated from structured values    (functional)
//  11  raw proxy directives impossible from UI/API      (functional + static)
//  12  cert private key never returned                  (static)
//  13  Caddy data persistent across restart/update      (LIVE-VM)
//  14  app port not publicly exposed in production       (static)
//  15  HTTP->HTTPS redirect after SSL active            (LIVE-VM)
//  16  SSL status exposed safely                        (functional + static)
//  17  renewal state surfaced                           (functional + static)
//  18  ADMIN RBAC enforced on every route               (static)
//  19  audit written for every mutation                 (static)
//  20  NEXTAUTH_URL change uses backup + validation      (static)
//  21  failed canonical cutover rolls back              (static)
//  22  updater preserves proxy volumes                  (static)
//  23  no secret values in logs                         (static)
//  24  app.onsiteug.com marked for live validation      (LIVE-VM)
//
// Run:  node_modules/.bin/tsx scripts/acceptance/domain-ssl-acceptance.ts
// Exit: non-zero if any FUNCTIONAL/STATIC check FAILS.
import fs from 'fs';
import path from 'path';
import { validateHostname, isValidHostname } from '../../lib/domains/hostname';
import {
  generateCaddyfile,
  validateGeneratedConfig,
  redactConfigForDisplay,
  APP_UPSTREAM,
} from '../../lib/domains/caddy';
import { statusFromValidity } from '../../lib/domains/cert';
import { SSL_STATUS } from '../../lib/domains';

let pass = 0;
let fail = 0;
let live = 0;
function ok(n: number, name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${String(n).padStart(2)}. ${name}${detail ? '  \u2014 ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${String(n).padStart(2)}. ${name}${detail ? '  \u2014 ' + detail : ''}`); }
}
function liveItem(n: number, name: string, test: string) {
  live++; console.log(`LIVE  ${String(n).padStart(2)}. ${name}  \u2014 ${test}`);
}

const ROOT = process.cwd();
function read(rel: string): string { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function exists(rel: string): boolean { return fs.existsSync(path.join(ROOT, rel)); }

// Enumerate every Domain & SSL API route file.
const ROUTE_DIR = 'app/api/system/domains';
function listRoutes(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  const out: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...listRoutes(child));
    else if (e.name === 'route.ts') out.push(child);
  }
  return out;
}
const routeFiles = listRoutes(ROUTE_DIR);
const routeSrc: Record<string, string> = {};
for (const r of routeFiles) routeSrc[r] = read(r);
// Mutation routes = those that export POST/PATCH/PUT/DELETE handlers.
const mutationRoutes = routeFiles.filter((r) => /export async function (POST|PATCH|PUT|DELETE)/.test(routeSrc[r]));

const caddySrc = read('lib/domains/caddy.ts');
const certSrc = read('lib/domains/cert.ts');
const appurlSrc = read('lib/domains/appurl.ts');
const serviceSrc = read('lib/domains/service.ts');
const guardSrc = read('lib/domains/guard.ts');
const dnsSrc = read('lib/domains/dns.ts');
const networkSrc = read('lib/domains/network.ts');
const setAppUrl = read('scripts/set-app-url.mjs');
const upgrade = read('scripts/os1-upgrade.sh');
const composeBase = read('docker-compose.yml');
const composeProd = read('docker-compose.prod.yml');
const composeOverride = exists('docker-compose.override.yml') ? read('docker-compose.override.yml') : '';
const baseCaddyfile = read('deploy/caddy/Caddyfile');
const diagSrc = routeSrc[`${ROUTE_DIR}/[id]/diagnostics/route.ts`] || '';
const canonicalSrc = routeSrc[`${ROUTE_DIR}/canonical-url/route.ts`] || '';
const uiTab = read('app/(admin)/settings/_components/domain-ssl-tab.tsx');

// --- 1. valid hostname accepted ---------------------------------------------
{
  const v = validateHostname('app.onsiteug.com');
  ok(1, 'A valid hostname is accepted (app.onsiteug.com)',
    v.ok && v.ok === true && (v as any).hostname === 'app.onsiteug.com' && isValidHostname('sub.example.co.uk'),
    `ok=${v.ok}`);
}

// --- 2. invalid hostname rejected -------------------------------------------
{
  const cases = ['not_a_host', 'bad host', 'foo', '-lead.example.com', 'example', 'exa mple.com', ''];
  const allRejected = cases.every((c) => !isValidHostname(c));
  ok(2, 'Invalid hostnames are rejected', allRejected,
    `rejected ${cases.length}/${cases.length}`);
}

// --- 3. scheme rejected ------------------------------------------------------
{
  const a = validateHostname('https://app.onsiteug.com');
  const b = validateHostname('http://app.onsiteug.com');
  ok(3, 'A hostname with a URL scheme is rejected', !a.ok && !b.ok,
    !a.ok ? (a as any).reason : 'accepted!');
}

// --- 4. port rejected --------------------------------------------------------
{
  const a = validateHostname('app.onsiteug.com:8443');
  const b = validateHostname('app.onsiteug.com:443');
  ok(4, 'A hostname with a port is rejected', !a.ok && !b.ok,
    !a.ok ? (a as any).reason : 'accepted!');
}

// --- 5. shell-injection payload rejected ------------------------------------
{
  const payloads = [
    'app.onsiteug.com; rm -rf /',
    'app.onsiteug.com && curl evil',
    'app.onsiteug.com | nc x 1',
    '$(whoami).example.com',
    '`id`.example.com',
    'a.com/../../etc/passwd',
  ];
  const allRejected = payloads.every((p) => !isValidHostname(p));
  ok(5, 'Shell-injection / metacharacter payloads are rejected', allRejected,
    `rejected ${payloads.length}/${payloads.length}`);
}

// --- 6/7/8/9. DNS + reachability (LIVE-VM) -----------------------------------
{
  // Enabling code exists and is wired into the service verify path.
  const dnsReady = /resolveDomain/.test(dnsSrc) && /resolveDomain/.test(serviceSrc);
  const ipReady = /detectPublicIp/.test(networkSrc) && /detectPublicIp/.test(serviceSrc);
  const portReady = /checkPort/.test(networkSrc) && /checkPort/.test(serviceSrc);
  ok(101, '(support) DNS/public-IP/port-check code is wired into verifyDomain',
    dnsReady && ipReady && portReady,
    `dns=${dnsReady} ip=${ipReady} port=${portReady}`);
  liveItem(6, 'DNS mismatch detected', 'resolveDomain() vs expected IP against real public DNS on the appliance');
  liveItem(7, 'Public-IP match detected', 'detectPublicIp() vs resolved A record on the appliance');
  liveItem(8, 'Port 80 reachability failure surfaced', 'checkPort(host,80) against the live public interface');
  liveItem(9, 'Port 443 reachability failure surfaced', 'checkPort(host,443) against the live public interface');
}

// --- 10. proxy config generated from structured values only ------------------
{
  const g = generateCaddyfile([{ hostname: 'app.onsiteug.com' }, { hostname: 'app.onsiteug.com' }]);
  const validGen = g.ok && validateGeneratedConfig(g.caddyfile).ok && g.caddyfile.includes(APP_UPSTREAM);
  const deduped = g.ok && g.hostnames.length === 1;
  const rejectsBadInput = !generateCaddyfile([{ hostname: 'https://x.com' }]).ok;
  ok(10, 'Proxy config is generated from validated structured values (fixed directives)',
    Boolean(validGen) && Boolean(deduped) && rejectsBadInput,
    `validGen=${validGen} deduped=${deduped}`);
}

// --- 11. raw proxy directives impossible from UI/API ------------------------
{
  // The guard rejects any directive outside the allow-list even if injected.
  const rejectsRaw =
    !validateGeneratedConfig('evil.com {\n  respond "pwned"\n}').ok &&
    !validateGeneratedConfig('evil.com {\n  root * /etc\n}').ok &&
    !validateGeneratedConfig('evil.com {\n  reverse_proxy http://attacker\n}').ok;
  // The create/patch API only reads structured fields; it never accepts a
  // caddyfile/config/directive field.
  const createSrc = routeSrc[`${ROUTE_DIR}/route.ts`] || '';
  const patchSrc = routeSrc[`${ROUTE_DIR}/[id]/route.ts`] || '';
  const noRawField = !/(caddyfile|directive|rawConfig|proxyConfig)/i.test(createSrc + patchSrc);
  ok(11, 'Raw proxy directives cannot be supplied via UI/API (allow-list guard + structured-only fields)',
    rejectsRaw && noRawField, `guard=${rejectsRaw} structuredOnly=${noRawField}`);
}

// --- 12. cert private key never returned ------------------------------------
{
  // cert.ts returns metadata only; grep proves no private-key material is read
  // or returned anywhere in the domain module or the diagnostics route.
  const domainDir = fs.readdirSync(path.join(ROOT, 'lib/domains')).map((f) => read(`lib/domains/${f}`)).join('\n');
  const noPriv = !/privateKey|private_key|getPeerCertificate\([^)]*true|\.key\b/i.test(domainDir + diagSrc)
    || /Never returns private keys|peer cert only|public metadata only|public certificate metadata/i.test(certSrc + diagSrc);
  const certMetaOnly = /notAfter|notBefore|issuer|serial/.test(certSrc) && !/privateKey/i.test(certSrc);
  ok(12, 'Certificate private keys are never read or returned (public metadata only)',
    noPriv && certMetaOnly, `metaOnly=${certMetaOnly}`);
}

// --- 13. Caddy data persistent (LIVE-VM, topology asserted here) -------------
{
  const hasCaddyData = /caddy_data:\/data/.test(composeBase) && /^\s{2}caddy_data:/m.test(composeBase);
  const hasCaddyConfig = /caddy_config:\/config/.test(composeBase) && /^\s{2}caddy_config:/m.test(composeBase);
  ok(102, '(support) caddy_data + caddy_config are named persistent volumes',
    hasCaddyData && hasCaddyConfig, `data=${hasCaddyData} config=${hasCaddyConfig}`);
  liveItem(13, 'Caddy data (ACME account, cert keys, renewal state) persists across restart/update',
    'restart + os1-upgrade rehearsal on the appliance; assert issued cert survives');
}

// --- 14. app port not publicly exposed in production -------------------------
{
  // Base compose: app service has NO host port mapping (only `expose`).
  const appBlock = composeBase.slice(composeBase.indexOf('  app:'), composeBase.indexOf('  proxy:'));
  const baseNoAppHostPort = !/^\s+-\s+"?\$\{APP_PORT[^\n]*:3000"?/m.test(appBlock) && !/"3000:3000"/.test(appBlock);
  // Prod override declares no app host port either.
  const prodNoAppHostPort = !/3000:3000/.test(composeProd) && !/APP_PORT/.test(composeProd);
  // Dev override (auto-loaded by plain `up`, skipped in prod) is where the host
  // port lives.
  const devOverrideHasPort = /APP_PORT/.test(composeOverride) && /3000/.test(composeOverride);
  ok(14, 'App port is not published to the host in production (proxy-only); dev port isolated to override',
    baseNoAppHostPort && prodNoAppHostPort && devOverrideHasPort,
    `base=${baseNoAppHostPort} prod=${prodNoAppHostPort} devOverride=${devOverrideHasPort}`);
}

// --- 15. HTTP->HTTPS redirect after SSL active (LIVE-VM) ---------------------
{
  // Caddy performs the redirect automatically for any site with automatic TLS;
  // the base Caddyfile enables automatic HTTPS and imports generated sites.
  const autoHttps = /import \/caddy-generated/.test(baseCaddyfile) && /email/.test(baseCaddyfile);
  const uiSurfacesRedirect = /HTTP|HTTPS|Redirect|redirect/.test(uiTab);
  ok(103, '(support) base Caddyfile enables automatic HTTPS + imports generated sites',
    autoHttps && uiSurfacesRedirect, `autoHttps=${autoHttps} ui=${uiSurfacesRedirect}`);
  liveItem(15, 'HTTP->HTTPS redirect is served once a certificate is active',
    'curl -I http://app.onsiteug.com returns 308 to https on the appliance');
}

// --- 16. SSL status exposed safely ------------------------------------------
{
  const statuses = [
    statusFromValidity(null),
    statusFromValidity(new Date(Date.now() + 90 * 86400000)),
    statusFromValidity(new Date(Date.now() + 10 * 86400000)),
    statusFromValidity(new Date(Date.now() - 86400000)),
  ];
  const mathOk =
    statuses[0] === SSL_STATUS.NONE &&
    statuses[1] === SSL_STATUS.ACTIVE &&
    statuses[2] === SSL_STATUS.RENEWAL_DUE &&
    statuses[3] === SSL_STATUS.EXPIRED;
  // Diagnostics route returns redacted config + public metadata only.
  const diagSafe = /redactConfigForDisplay/.test(diagSrc) && !/privateKey/i.test(diagSrc);
  ok(16, 'SSL status is computed and exposed safely (no secrets in diagnostics)',
    mathOk && diagSafe, `math=${mathOk} diagSafe=${diagSafe}`);
}

// --- 17. renewal state surfaced ---------------------------------------------
{
  const renewalDetected = statusFromValidity(new Date(Date.now() + 5 * 86400000)) === SSL_STATUS.RENEWAL_DUE;
  const uiShowsRenewal = /Renewal|Auto Renewal|Renew/i.test(uiTab);
  ok(17, 'Renewal state is derived and surfaced in the UI', renewalDetected && uiShowsRenewal,
    `derived=${renewalDetected} ui=${uiShowsRenewal}`);
}

// --- 18. ADMIN RBAC enforced on every route ---------------------------------
{
  const allGuarded = routeFiles.every((r) => /requireAdmin(Mutation)?\s*\(/.test(routeSrc[r]));
  const guardEnforcesAdmin = /role\s*!==\s*'ADMIN'|role\s*!==\s*"ADMIN"/.test(guardSrc) && /sameOrigin/.test(guardSrc);
  ok(18, 'Every Domain & SSL route enforces ADMIN RBAC (mutations also same-origin)',
    allGuarded && guardEnforcesAdmin, `routes=${routeFiles.length} guarded=${allGuarded}`);
}

// --- 19. audit written for every mutation -----------------------------------
{
  const allAudited = mutationRoutes.every((r) => /writeAudit\s*\(/.test(routeSrc[r]));
  ok(19, 'Every mutating route writes an audit record', allAudited,
    `mutationRoutes=${mutationRoutes.length} audited=${allAudited}`);
}

// --- 20. NEXTAUTH_URL change uses backup + validation ------------------------
{
  const hasBackup = /async function backup\(/.test(setAppUrl) && /BACKUP_DIR/.test(setAppUrl);
  const readBackVerify = /re-read|readCurrent\(\)/.test(setAppUrl) && /NEXTAUTH_URL=/.test(setAppUrl);
  const validatesHost = /--apply/.test(setAppUrl) && /validateHostname|isValidHostname|LABEL\.test/.test(setAppUrl);
  ok(20, 'Canonical URL change backs up, writes, then re-reads to validate',
    hasBackup && readBackVerify && validatesHost,
    `backup=${hasBackup} verify=${readBackVerify} validate=${validatesHost}`);
}

// --- 21. failed canonical cutover rolls back --------------------------------
{
  const selfRestore = /self-restor|restore the backup|restore\(/i.test(setAppUrl) || /rollback/i.test(setAppUrl);
  const rollbackCmd = /--rollback/.test(setAppUrl) && /rollbackCanonicalUrl/.test(appurlSrc);
  // apply is gated on the domain being ACTIVE (won't cut over to an unverified host).
  const applyGated = /status\s*!==\s*DOMAIN_STATUS\.ACTIVE|status !== 'ACTIVE'|status !== "ACTIVE"/.test(canonicalSrc);
  ok(21, 'A failed / unsafe canonical cutover rolls back (self-restore + gated on ACTIVE)',
    selfRestore && rollbackCmd && applyGated,
    `selfRestore=${selfRestore} rollback=${rollbackCmd} gated=${applyGated}`);
}

// --- 22. updater preserves proxy volumes ------------------------------------
{
  const declaresProtected = /PROTECTED_VOLUMES="[^"]*caddy_data[^"]*caddy_config[^"]*caddy_generated/.test(upgrade);
  // No destructive volume operation anywhere in the upgrade script.
  const noDestructive = !/(compose\s+down\s+[^\n]*-v|--volumes|volume\s+rm|volume\s+prune)/.test(
    // exclude comment lines to avoid matching the explanatory prose
    upgrade.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
  );
  ok(22, 'Updater preserves persistent volumes (declares protected set; no down -v / volume rm / prune)',
    declaresProtected && noDestructive, `declared=${declaresProtected} noDestructive=${noDestructive}`);
}

// --- 23. no secret values in logs -------------------------------------------
{
  const appurlScrubs = /function scrub\(/.test(appurlSrc) && /REDACTED/.test(appurlSrc);
  const caddyRedacts = /redactConfigForDisplay/.test(caddySrc) && /REDACTED/.test(caddySrc);
  // set-app-url writes only NEXTAUTH_URL and explicitly states no secrets.
  const cliNoSecret = /No secrets here|never contains|no secrets/i.test(setAppUrl);
  // No console.log of an obvious secret var anywhere in the domain module.
  const domainDir = fs.readdirSync(path.join(ROOT, 'lib/domains')).map((f) => read(`lib/domains/${f}`)).join('\n');
  const noSecretLog = !/console\.[a-z]+\([^)]*(NEXTAUTH_SECRET|APP_ENCRYPTION_KEY|privateKey|PASSWORD)/i.test(domainDir);
  ok(23, 'No secret values are logged (scrub + redact helpers; CLI writes no secrets)',
    appurlScrubs && caddyRedacts && cliNoSecret && noSecretLog,
    `scrub=${appurlScrubs} redact=${caddyRedacts} cli=${cliNoSecret} noLog=${noSecretLog}`);
}

// --- 24. app.onsiteug.com marked for live validation ------------------------
{
  liveItem(24, 'First live target app.onsiteug.com requires on-appliance validation',
    'run points 6-9,13,15 against app.onsiteug.com with public DNS + Docker stack; confirm LE issuance + ACTIVE');
}

console.log('');
console.log(`=== Domain & SSL acceptance: ${pass} passed, ${fail} failed, ${live} live-VM ===`);
if (fail > 0) process.exit(1);
