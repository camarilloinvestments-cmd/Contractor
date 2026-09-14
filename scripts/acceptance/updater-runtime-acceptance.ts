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
// Extended (M7 final cold-review — history persistence across a named volume):
//  17  host state file is fed to the recorder over STDIN, not an in-container path
//  18  recorder reads state JSON from STDIN (functional)
//  19  the dependable UpdateHistory row is created AFTER migrations, from candidate env
//  20  early (pre-0019) history persistence is best-effort and never aborts
//  22  a post-migration failure records FAILED from the candidate env
//  23  the state file is secret-free
//  24  the recorder invocation passes no secret env
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
    && /record-update-history\.mjs - < "\$STATE_FILE"/.test(upgrade);
  const writesRow = /prisma\.updateHistory\.create/.test(recordSrc) && /prisma\.updateHistory\.update/.test(recordSrc);
  ok(13, 'Successful run persists an UpdateHistory row (create/update, fed over STDIN)', persistsSuccess && writesRow);
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

// ---- 17: host STATE_FILE is never passed as an in-container path ----------
{
  const noContainerPathArg = !/record-update-history\.mjs "\$STATE_FILE"/.test(upgrade);
  const feedsStdin = /record-update-history\.mjs - < "\$STATE_FILE"/.test(upgrade);
  // compose mounts a NAMED volume, not a bind mount of the host data dir
  const composeNamedVolume = /app_data:\/app\/data/.test(compose)
    && !/\.\/data:\/app\/data/.test(compose)
    && !/\$\{?PWD\}?\/data:\/app\/data/.test(compose);
  ok(17, 'Host state file is fed to the recorder over STDIN (-), not an in-container path (named volume, no bind mount)',
    noContainerPathArg && feedsStdin && composeNamedVolume);
}

// ---- 18: recorder accepts state JSON over stdin (functional) --------------
{
  const rec = path.join(ROOT, 'scripts', 'record-update-history.mjs');
  const empty = spawnSync(NODE, [rec, '-'], { input: '', encoding: 'utf8' });
  const garbage = spawnSync(NODE, [rec, '-'], { input: 'not-json', encoding: 'utf8' });
  const valid = spawnSync(NODE, [rec, '-'], {
    input: '{"action":"INSTALL","source":"GITHUB","result":"IN_PROGRESS","startedAt":"2026-09-14T20:00:00Z"}',
    encoding: 'utf8',
  });
  const emptyRejected = empty.status === 1 && /no JSON received on stdin/.test(empty.stderr);
  const garbageRejected = garbage.status === 1 && /not valid JSON/.test(garbage.stderr);
  // valid JSON must get PAST the stdin/parse gate and reach the DB layer
  // (absent here) — i.e. it is NOT rejected for a stdin/parse/file reason.
  const validParsed = !/no JSON received|not valid JSON|state file not found/.test(valid.stderr)
    && /(failed to persist UpdateHistory|prisma)/i.test(valid.stderr + valid.stdout);
  ok(18, 'Recorder reads state JSON from STDIN (empty rejected, bad JSON rejected, valid JSON reaches DB layer)',
    emptyRejected && garbageRejected && validParsed);
}

// ---- 19: dependable row created AFTER migrations from candidate env -------
{
  const migIdx = upgrade.indexOf('migrations: COMPLETE (ran from candidate image)');
  const switchIdx = upgrade.indexOf('RECORDER_MODE="candidate"');
  const persistAfter = /RECORDER_MODE="candidate"\s*\npersist_history "IN_PROGRESS" ""/.test(upgrade);
  ok(19, 'After migrations, recorder switches to candidate env and persists the real row (create-or-update)',
    migIdx > 0 && switchIdx > migIdx && persistAfter);
}

// ---- 20: pre-0019 early persistence is best-effort (never aborts) ---------
{
  const fnStart = upgrade.indexOf('persist_history() {');
  const fnEnd = upgrade.indexOf('\n}', fnStart);
  const body = upgrade.slice(fnStart, fnEnd);
  const noFatalInPersist = !/\b(exit|die)\b/.test(body);
  const earlyGuarded = /persist_history "IN_PROGRESS" "" \|\| true/.test(upgrade);
  const preMigrationNote = /pre-migration UpdateHistory persistence unavailable/.test(upgrade);
  ok(20, 'Early (pre-0019) history persistence is best-effort and never aborts the upgrade',
    noFatalInPersist && earlyGuarded && preMigrationNote);
}

// ---- 22: post-migration failure records FAILED via candidate env ----------
{
  const diePersistsFailed = /die\(\) \{[\s\S]*?persist_history "FAILED"/.test(upgrade);
  const candidateBeforeCutover = upgrade.indexOf('RECORDER_MODE="candidate"') > 0
    && upgrade.indexOf('RECORDER_MODE="candidate"') < upgrade.indexOf('Cutover to candidate');
  ok(22, 'A post-migration failure records FAILED from the candidate env (die persists FAILED; candidate mode set before cutover/health)',
    diePersistsFailed && candidateBeforeCutover);
}

// ---- 23: state file is secret-free ---------------------------------------
{
  const ws = upgrade.slice(upgrade.indexOf('write_state() {'), upgrade.indexOf('run_recorder() {'));
  const leaks = /(DATABASE_URL|PASSWORD|_SECRET|PRIVATE_KEY|APP_ENCRYPTION_KEY|GITHUB_TOKEN|GH_TOKEN)/i.test(ws);
  ok(23, 'State file (write_state) contains only secret-free fields', !leaks && ws.length > 0);
}

// ---- 24: recorder invocation passes no secret env ------------------------
{
  const rr = upgrade.slice(upgrade.indexOf('run_recorder() {'), upgrade.indexOf('persist_history() {'));
  const noSecretInline = !/(DATABASE_URL|PASSWORD|_SECRET|PRIVATE_KEY|APP_ENCRYPTION_KEY|TOKEN)=/i.test(rr);
  ok(24, 'Recorder invocation passes no secret env (only image tag + build sha) and pipes a secret-free state file',
    noSecretInline && rr.length > 0);
}

// ===========================================================================
// First-upgrade QUIESCE guarantees (stop the old, non-gate-aware app before any
// DB mutation). Checks 30-40 map to the 11 quiesce acceptance points.
// ===========================================================================
const iBuild = upgrade.indexOf('Build candidate image');
const iQuiesce = upgrade.indexOf('Quiesce running application');
const iStopApp = upgrade.indexOf('$COMPOSE stop app');
const iMigrate = upgrade.indexOf('Apply migrations from candidate image');
const iMaintOn = upgrade.indexOf('Enter maintenance mode');
const iCutover = upgrade.indexOf('Cutover to candidate');
const i15b = upgrade.indexOf('15b.', iMigrate);
const migFailBranch = iMigrate > -1 && i15b > -1 ? upgrade.slice(iMigrate, i15b) : '';
const quiesceBlock = iQuiesce > -1 && iMigrate > -1 ? upgrade.slice(iQuiesce, iMigrate) : '';

// 30 (accept 1): candidate build precedes quiesce, so the build runs while the
// old app is still ONLINE (build < maintenance-on < quiesce/stop).
ok(30, 'Pre-maintenance candidate build leaves the old app online (build precedes quiesce/stop)',
  iBuild > -1 && iQuiesce > iBuild && iMaintOn > iBuild && iStopApp > iBuild,
  `build=${iBuild} maintOn=${iMaintOn} quiesce=${iQuiesce} stopApp=${iStopApp}`);

// 31 (accept 2): the old app is stopped BEFORE migrations.
ok(31, 'Old app is stopped BEFORE migration (stop app precedes migrate)',
  iStopApp > -1 && iMigrate > -1 && iStopApp < iMigrate, `stopApp=${iStopApp} migrate=${iMigrate}`);

// 32 (accept 3): only the app service is stopped; PostgreSQL is left running and
// is never stopped anywhere in the script.
{
  const stopsDb = /\$COMPOSE\s+stop\s+(db|postgres|postgresql)\b/.test(upgrade) ||
    /\$COMPOSE\s+stop\s+app\s+db\b/.test(upgrade);
  const leavesDbUp = /PostgreSQL (?:left running|untouched)/.test(quiesceBlock);
  ok(32, 'DB stays running during quiesce (only app is stopped; db never stopped)',
    !stopsDb && leavesDbUp, `stopsDb=${stopsDb} leavesDbUp=${leavesDbUp}`);
}

// 33 (accept 4): a stop failure STOPS the run before migrating (|| die).
ok(33, 'Stop failure prevents migration ($COMPOSE stop app || die, refusing to migrate)',
  /\$COMPOSE stop app[\s\S]{0,120}\|\| die "could not stop the running application before migration/.test(upgrade));

// 34 (accept 5): a migration failure leaves the old app stopped (no restart of
// the old app in the migration-failure branch; APP_STOPPED already =1).
{
  // Executed (non-echo) lines only: recovery *instructions* may mention how an
  // operator would later restart the prior app, but no command line may do so.
  const execOnly = migFailBranch.split('\n').filter((l) => !/^\s*echo\b/.test(l)).join('\n');
  const noRestart = !/\$COMPOSE (up|start) /.test(execOnly);
  const keptStopped = /old app(?:lication)? (?:kept stopped|remains STOPPED)/i.test(migFailBranch);
  ok(34, 'Failed migration leaves the old app stopped (no auto-restart of old image; recovery guidance excluded)',
    noRestart && keptStopped, `noRestart=${noRestart} keptStopped=${keptStopped}`);
}

// 35 (accept 6): a migration failure leaves maintenance ON (die never disables
// it; branch explicitly states maintenance held/remains ON).
{
  const disablesMaint = /run_maintenance off/.test(migFailBranch);
  const heldOn = /maintenance (?:held|remains) ON/i.test(migFailBranch);
  ok(35, 'Failed migration leaves maintenance ON', !disablesMaint && heldOn,
    `disablesMaint=${disablesMaint} heldOn=${heldOn}`);
}

// 36 (accept 7): candidate starts only AFTER a successful migration (cutover
// up -d is after the migrate step, which dies on failure).
ok(36, 'Candidate starts only after successful migration (cutover follows migrate)',
  iCutover > -1 && iMigrate > -1 && iCutover > iMigrate &&
  /\$COMPOSE up -d --no-build app/.test(upgrade.slice(iCutover)), `migrate=${iMigrate} cutover=${iCutover}`);

// 37 (accept 8): previous image/container identity is captured into state and
// persisted into history (write_state fields + recorder logs), before stop.
{
  const stateHasPrev = /previousContainerId/.test(upgrade) && /previousImageId/.test(upgrade) &&
    /previousImageRef/.test(upgrade) && /previousBuildSha/.test(upgrade);
  const capturedBeforeStop = quiesceBlock.indexOf('PREV_IMAGE_ID=') > -1 &&
    quiesceBlock.indexOf('$COMPOSE stop app') > -1 &&
    quiesceBlock.indexOf('PREV_IMAGE_ID=') < quiesceBlock.indexOf('$COMPOSE stop app');
  const recorderKeepsPrev = /previousImage:\s*s\.previousImageRef/.test(recordSrc) &&
    /previousContainerId:\s*s\.previousContainerId/.test(recordSrc);
  ok(37, 'Previous image/container identity recorded in state + history (captured before stop)',
    stateHasPrev && capturedBeforeStop && recorderKeepsPrev,
    `state=${stateHasPrev} beforeStop=${capturedBeforeStop} recorder=${recorderKeepsPrev}`);
}

// 38 (accept 9): successful cutover serves the EXACT candidate image (identity
// asserted; mismatch STOPS) - reuses the cutover identity guard.
ok(38, 'Successful cutover serves the exact candidate image (identity mismatch STOPS)',
  /RUNNING_IMAGE_ID" != "\$CANDIDATE_IMAGE_ID"/.test(upgrade) &&
  /cutover did not serve the verified build/.test(upgrade));

// 39 (accept 10): future upgrades stay compatible - quiesce degrades gracefully
// when there is no running container to stop (no die; APP_STOPPED=1).
{
  const gracefulNoApp = /no running app container found \(nothing to quiesce\)/.test(quiesceBlock) &&
    /no old app process to stop; PostgreSQL untouched/.test(quiesceBlock);
  ok(39, 'Future upgrade path stays compatible (quiesce idempotent; no-running-app path never dies)',
    gracefulNoApp);
}

// 40 (accept 11): the quiesce block and its recovery messages never print a secret.
{
  const secretRe = /(DATABASE_URL|PASSWORD|_SECRET|PRIVATE_KEY|APP_ENCRYPTION_KEY|GITHUB_TOKEN|GH_TOKEN)\b/i;
  ok(40, 'Quiesce + recovery messaging never logs a secret',
    quiesceBlock.length > 0 && !secretRe.test(quiesceBlock) && !secretRe.test(migFailBranch));
}

// ---- Live-VM items (require Docker + Postgres) ----------------------------
liveItem(7, 'First-upgrade quiesce at runtime', 'On live VM (old pre-gate image running): the run stops the app container before migrations while PostgreSQL keeps running; docker inspect {{.State.Running}} on the old container is false before migrate, and a stop failure aborts before any migration.');
liveItem(1, 'Cutover identity at runtime', 'On live VM w/ Docker: after cutover, `docker inspect --format {{.Image}} $(docker compose ps -q app)` MUST equal the validated candidate image id; a mismatch STOPS.');
liveItem(2, 'Mandatory DB backup at runtime', 'On live VM w/ Postgres: confirm a non-empty gzip pg_dump (mode 600 + .sha256) exists BEFORE migrate deploy; removing the backup path aborts the run.');
liveItem(3, 'Migrations from candidate', 'On live VM w/ Docker: `docker compose run --rm` on the candidate image runs db-bootstrap.mjs; migration failure aborts with DATABASE RESTORE REQUIRED.');
liveItem(4, 'Health failure rollback', 'On live VM: force /api/health to 503 post-cutover -> run marks HEALTH FAILED, holds maintenance ON, reports DATABASE RESTORE REQUIRED, and does NOT print COMPLETE.');
liveItem(5, 'UpdateHistory persisted', 'On live VM w/ Postgres: a successful run inserts one UpdateHistory row (result=SUCCESS, from/to version+commit, backup/migration/health results, durationMs) via record-update-history.mjs fed over STDIN.');
liveItem(6, 'Upgrade from DB baseline 0017', 'On live VM w/ Postgres seeded at migration 0017: the run completes; early history persistence is skipped without error and the real UpdateHistory row is CREATED after 0018/0019 apply (from the candidate image), then UPDATED to SUCCESS.');

console.log(`\n=== Updater Runtime Acceptance: ${pass} passed, ${fail} failed, ${live} live-VM ===`);
if (fail > 0) process.exit(1);
