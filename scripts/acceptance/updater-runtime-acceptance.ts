// Updater Runtime Acceptance Harness (M7 cold-review corrections).
//
// Proves the 16 runtime guarantees the self-host updater (scripts/os1-upgrade.sh
// + scripts/verify-release.mjs + scripts/record-update-history.mjs +
// docker-compose.yml) must satisfy. Where Docker/Postgres are required, the
// code path is asserted statically and the live execution is flagged
// LIVE-VM VALIDATION REQUIRED. The signature/checksum gates are exercised
// FUNCTIONALLY by really running verify-release.mjs against crafted fixtures,
// and the CLI parser is exercised by really running os1-upgrade.sh.
//
//   1  candidate image id is captured
//   2  running image == validated candidate after cutover (else STOP)
//   3  DB backup is mandatory and cannot be skipped
//   4  env backup is a restorable copy (0600 + checksum), never printed
//   5  an unresolvable/wrong ref STOPS before any mutation
//   6  a bad signature STOPS (functional)
//   7  a bad checksum STOPS (functional)
//   8  a checkout HEAD mismatch STOPS
//   9  a candidate build failure leaves the current app running (build < cutover)
//  10  migrations run FROM the candidate image
//  11  a failed health check never reports success (STOP)
//  12  a post-migration failure reports DATABASE RESTORE REQUIRED
//  13  a successful run persists an UpdateHistory row
//  14  secrets are never printed by the updater scripts
//  15  CLI --ref parses (functional)
//  16  CLI --channel parses/validates (functional)
//
// Run:  node_modules/.bin/tsx scripts/acceptance/updater-runtime-acceptance.ts
// Exit: non-zero if any check FAILS.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';

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

const upgrade = read('scripts/os1-upgrade.sh');
const verifySrc = read('scripts/verify-release.mjs');
const recordSrc = read('scripts/record-update-history.mjs');
const compose = read('docker-compose.yml');
const NODE = process.execPath;

// ---- 1: candidate image id captured ---------------------------------------
ok(1, 'Candidate image id is captured after build',
  /CANDIDATE_IMAGE_ID="\$\(docker image inspect --format '\{\{\.Id\}\}' "\$CANDIDATE_TAG"\)"/.test(upgrade));

// ---- 2: running == validated candidate after cutover ----------------------
{
  const capturesRunning = /RUNNING_IMAGE_ID="\$\(docker inspect --format '\{\{\.Image\}\}' "\$RUNNING_CID"\)"/.test(upgrade);
  const assertsEqual = /if \[ "\$RUNNING_IMAGE_ID" != "\$CANDIDATE_IMAGE_ID" \]; then[\s\S]*?die /.test(upgrade);
  ok(2, 'Cutover asserts running image id == validated candidate id (else STOP)', capturesRunning && assertsEqual);
}

// ---- 2b: compose is wired to a swappable image ref ------------------------
ok(21, 'docker-compose app service uses image: ${CONTRACTOR_APP_IMAGE:-contractor-app:current}',
  /image:\s*\$\{CONTRACTOR_APP_IMAGE:-contractor-app:current\}/.test(compose));

// ---- 3: DB backup mandatory ----------------------------------------------
{
  const mandatory = /no working backup path[\s\S]*?refusing to mutate/.test(upgrade)
    && /\[ -s "\$BACKUP" \] \|\| die/.test(upgrade)
    && /BACKUP_RESULT="COMPLETE"/.test(upgrade)
    && /sha256sum "\$BACKUP"/.test(upgrade)
    && /chmod 600 "\$BACKUP"/.test(upgrade);
  const usesComposePgDump = /\$COMPOSE exec -T db pg_dump -U "\$PGUSER_C" "\$PGDB_C"/.test(upgrade);
  ok(3, 'DB backup is mandatory (compose pg_dump, non-empty, chmod 600, sha256, STOP on failure)', mandatory && usesComposePgDump);
}

// ---- 4: env backup restorable --------------------------------------------
{
  const restorable = /cp "\$ENV_SRC" "\$ENV_BACKUP"/.test(upgrade)
    && /chmod 600 "\$ENV_BACKUP"/.test(upgrade)
    && /sha256sum "\$ENV_BACKUP"/.test(upgrade);
  const noValuePrint = !/echo[^\n]*\$ENV_SRC[^\n]*cat|cat "\$ENV_SRC"/.test(upgrade);
  ok(4, 'Env backup is a restorable copy (0600 + checksum), contents never printed', restorable && noValuePrint);
}

// ---- 5: wrong/unresolvable ref stops -------------------------------------
ok(5, 'Unresolvable ref STOPS before mutation (git rev-parse --verify --quiet ... || die)',
  /TARGET_FULL_SHA="\$\(git rev-parse --verify --quiet "\$\{RELEASE_REF\}\^\{commit\}"\)"[\s\S]*?\|\| die/.test(upgrade));

// ---- functional signature/checksum fixtures (checks 6 & 7) ---------------
function makeFixture(): { dir: string; pubPem: string; goodManifest: any; pkgName: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-rel-'));
  const staging = path.join(dir, 'data', 'updates', 'staging');
  fs.mkdirSync(staging, { recursive: true });
  const pkgName = 'release-pkg.tar.gz';
  const pkgBytes = Buffer.from('OS1-FTP release payload fixture');
  fs.writeFileSync(path.join(staging, pkgName), pkgBytes);
  const sha256 = crypto.createHash('sha256').update(pkgBytes).digest('hex');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const manifest: any = {
    product: 'os1-fiber-track-pro',
    version: '1.2.0',
    commit: 'a'.repeat(40),
    channel: 'stable',
    filename: pkgName,
    sha256,
    signatureAlgorithm: 'RSA-SHA256',
  };
  // canonical bytes: drop signature fields, sort keys (mirrors verify-release.mjs)
  const { signature, signatureAlgorithm, ...rest } = manifest;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(rest).sort()) sorted[k] = rest[k];
  const canonical = Buffer.from(JSON.stringify(sorted), 'utf8');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(canonical); signer.end();
  manifest.signature = signer.sign(privateKey).toString('base64');
  fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { dir, pubPem, goodManifest: manifest, pkgName };
}
function runVerify(dir: string, pubPem: string, extraEnv: Record<string, string> = {}) {
  return spawnSync(NODE, [path.join(ROOT, 'scripts', 'verify-release.mjs'), '--channel', 'stable'], {
    cwd: dir,
    env: { ...process.env, UPDATE_SIGNING_PUBLIC_KEY_PEM: pubPem, ...extraEnv },
    encoding: 'utf8',
  });
}

// happy path (proves the gate passes a genuinely valid package) + checks 6/7
let fx: { dir: string; pubPem: string; goodManifest: any; pkgName: string } | null = null;
try {
  fx = makeFixture();
  const good = runVerify(fx.dir, fx.pubPem);
  let goodJson: any = null; try { goodJson = JSON.parse(good.stdout.trim()); } catch { /* */ }
  ok(60, 'verify-release.mjs PASSES a valid signed+checksummed package', good.status === 0 && goodJson?.ok === true,
    good.status === 0 ? `version=${goodJson?.version} commit=${goodJson?.commit}` : `exit=${good.status}`);

  // ---- 6: bad signature stops ----
  const staging = path.join(fx.dir, 'data', 'updates', 'staging');
  const m = JSON.parse(fs.readFileSync(path.join(staging, 'manifest.json'), 'utf8'));
  const sigBuf = Buffer.from(m.signature, 'base64'); sigBuf[0] ^= 0xff; // flip a byte
  const tampered = { ...m, signature: sigBuf.toString('base64') };
  fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(tampered, null, 2));
  const badSig = runVerify(fx.dir, fx.pubPem);
  ok(6, 'Bad signature STOPS verification (exit 1)', badSig.status === 1 && /signature verification failed/i.test(badSig.stderr));

  // restore good manifest, then corrupt the package bytes for the checksum test
  fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(fx.goodManifest, null, 2));
  fs.writeFileSync(path.join(staging, fx.pkgName), Buffer.from('corrupted payload bytes'));
  const badSum = runVerify(fx.dir, fx.pubPem);
  ok(7, 'Bad checksum STOPS verification (exit 1)', badSum.status === 1 && /checksum mismatch/i.test(badSum.stderr));
} catch (e) {
  ok(60, 'verify-release.mjs functional fixture', false, String((e as Error)?.message ?? e));
  ok(6, 'Bad signature STOPS verification', false, 'fixture error');
  ok(7, 'Bad checksum STOPS verification', false, 'fixture error');
} finally {
  if (fx) fs.rmSync(fx.dir, { recursive: true, force: true });
}

// ---- 8: checkout HEAD mismatch stops -------------------------------------
ok(8, 'Checkout verifies HEAD == target (else STOP)',
  /HEAD_NOW="\$\(git rev-parse HEAD\)"[\s\S]*?\[ "\$HEAD_NOW" = "\$TARGET_FULL_SHA" \] \|\| die/.test(upgrade)
  && /git checkout --quiet --detach "\$TARGET_FULL_SHA" \|\| die/.test(upgrade));

// ---- 9: candidate build failure leaves current app running ---------------
{
  const buildIdx = upgrade.indexOf('Build candidate image');
  const cutoverIdx = upgrade.indexOf('Cutover to candidate');
  const buildDies = /candidate image build failed \(running app untouched, no cutover attempted\)/.test(upgrade);
  ok(9, 'Candidate build precedes cutover and a build failure leaves the app running',
    buildIdx > 0 && cutoverIdx > buildIdx && buildDies);
}

// ---- 10: migrations run FROM the candidate image -------------------------
ok(10, 'Migrations run from the candidate image (compose run --rm candidate db-bootstrap)',
  /CONTRACTOR_APP_IMAGE="\$CANDIDATE_TAG"[\s\S]*?\$COMPOSE run --rm -T --no-deps --entrypoint node app scripts\/db-bootstrap\.mjs/.test(upgrade));

// ---- 11: failed health never reports success -----------------------------
{
  const healthFailStops = /HEALTH_RESULT="FAILED"[\s\S]*?die /.test(upgrade);
  const successOnlyAfterOk = upgrade.indexOf('HEALTH_RESULT="OK"') < upgrade.indexOf('upgrade COMPLETE:');
  ok(11, 'A failed health check STOPS (never prints COMPLETE)', healthFailStops && successOnlyAfterOk);
}

// ---- 12: post-migration failure demands DB restore -----------------------
{
  const migFailRestore = /MIGRATIONS_RESULT="FAILED"[\s\S]*?ROLLBACK_RESULT="DB_RESTORE_REQUIRED"[\s\S]*?die "migration failed \u2014 DATABASE RESTORE REQUIRED/.test(upgrade);
  const healthFailRestore = /ROLLBACK_RESULT="DB_RESTORE_REQUIRED"[\s\S]*?DATABASE RESTORE REQUIRED from \$BACKUP; maintenance held ON/.test(upgrade);
  ok(12, 'Post-migration failure reports DATABASE RESTORE REQUIRED (with backup path)', migFailRestore && healthFailRestore);
}

// ---- 13: successful run persists UpdateHistory ---------------------------
{
  const persistsSuccess = /persist_history "SUCCESS"/.test(upgrade)
    && /\$COMPOSE exec -T app node scripts\/record-update-history\.mjs "\$STATE_FILE"/.test(upgrade);
  const writesRow = /prisma\.updateHistory\.create/.test(recordSrc) && /prisma\.updateHistory\.update/.test(recordSrc);
  ok(13, 'Successful run persists an UpdateHistory row (create/update via candidate container)', persistsSuccess && writesRow);
}

// ---- 14: secrets never printed -------------------------------------------
{
  const all = upgrade + '\n' + verifySrc + '\n' + recordSrc;
  const echoLeak = /echo[^\n]*\$\{?(GITHUB_TOKEN|GH_TOKEN|[A-Z_]*_SECRET|[A-Z_]*PASSWORD|[A-Z_]*PRIVATE_KEY|APP_ENCRYPTION_KEY|DATABASE_URL)\b/i.test(all);
  const loadEnvNoPrint = /values not shown/.test(upgrade) && !/echo[^\n]*"\$val"/.test(upgrade);
  ok(14, 'Updater scripts never echo a secret value', !echoLeak && loadEnvNoPrint);
}

// ---- 15 & 16: CLI parsing (functional) -----------------------------------
function runUpgrade(args: string[]) {
  return spawnSync('bash', [path.join(ROOT, 'scripts', 'os1-upgrade.sh'), ...args], {
    cwd: ROOT, env: { ...process.env }, encoding: 'utf8',
  });
}
{
  const help = runUpgrade(['--help']);
  const noArgs = runUpgrade([]);
  const bothModes = runUpgrade(['--ref', 'abc', '--channel', 'stable']);
  const unknown = runUpgrade(['--bogus']);
  const refParsed = /--ref\)\s*RELEASE_REF=/.test(upgrade) && /--ref=\*\)\s*RELEASE_REF=/.test(upgrade);
  ok(15, 'CLI --ref parses; --help exits 0; missing mode exits 2; both modes rejected',
    help.status === 0 && noArgs.status === 2 && bothModes.status === 2 && unknown.status === 2 && refParsed);

  const badChannel = runUpgrade(['--channel', 'nightly']);
  const channelValidated = /stable\|rc\|beta\)\s*:\s*;;/.test(upgrade);
  ok(16, 'CLI --channel validates stable|rc|beta (invalid exits 2)',
    badChannel.status === 2 && /must be one of stable\|rc\|beta/.test(badChannel.stderr) && channelValidated);
}

// ---- Live-VM items (require Docker + Postgres) ----------------------------
liveItem(1, 'Cutover identity at runtime', 'On live VM w/ Docker: after cutover, `docker inspect --format {{.Image}} $(docker compose ps -q app)` MUST equal the validated candidate image id; a mismatch STOPS.');
liveItem(2, 'Mandatory DB backup at runtime', 'On live VM w/ Postgres: confirm a non-empty gzip pg_dump (mode 600 + .sha256) exists BEFORE migrate deploy; removing the backup path aborts the run.');
liveItem(3, 'Migrations from candidate', 'On live VM w/ Docker: `docker compose run --rm` on the candidate image runs db-bootstrap.mjs; migration failure aborts with DATABASE RESTORE REQUIRED.');
liveItem(4, 'Health failure rollback', 'On live VM: force /api/health to 503 post-cutover -> run marks HEALTH FAILED, holds maintenance ON, reports DATABASE RESTORE REQUIRED, and does NOT print COMPLETE.');
liveItem(5, 'UpdateHistory persisted', 'On live VM w/ Postgres: a successful run inserts one UpdateHistory row (result=SUCCESS, from/to version+commit, backup/migration/health results, durationMs) via record-update-history.mjs.');

console.log(`\n=== Updater Runtime Acceptance: ${pass} passed, ${fail} failed, ${live} live-VM ===`);
if (fail > 0) process.exit(1);
