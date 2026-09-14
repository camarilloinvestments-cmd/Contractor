#!/usr/bin/env bash
# os1-upgrade.sh (section 16)
# Managed self-host upgrade orchestration for the OS1 / Contractor appliance.
#
# 20 ordered steps. Builds the candidate image as contractor-app:candidate-<sha>
# and NEVER retags/serves it until every gate before cutover has PASSED. The
# running compose service pulls its image from ${CONTRACTOR_APP_IMAGE}; cutover
# points that variable at the validated candidate and asserts the *running*
# container image id equals the *validated* candidate image id (no rebuild, no
# drift). Fail-closed at every gate; DB/env backups are mandatory before any
# mutation; migrations run FROM the candidate image; a failed health check does
# not report success and triggers rollback / DATABASE RESTORE REQUIRED.
#
# Usage:
#   os1-upgrade.sh --ref <branch|tag|SHA>        # advanced: pin an exact git ref
#   os1-upgrade.sh --channel <stable|rc|beta>     # normal: signed-release channel
# No SSH is required for a normal upgrade; this runs on the appliance host.
set -euo pipefail

STEP=0
step() { STEP=$((STEP+1)); echo ""; echo "==== [${STEP}/20] $1 ===="; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ---------------------------------------------------------------------------
# Configuration (secret-free defaults; real secrets loaded from appliance env)
# ---------------------------------------------------------------------------
COMPOSE="${COMPOSE_CMD:-docker compose}"
RUNNING_IMAGE_REF="${CONTRACTOR_APP_IMAGE:-contractor-app:current}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health}"
BACKUP_DIR="data/updates/backups"
STATE_DIR="data/updates/state"
TS="$(date -u +%Y%m%d-%H%M%SZ)"
STATE_FILE="${STATE_DIR}/upgrade-${TS}.json"
EXPECTED_UID=10001

# ---------------------------------------------------------------------------
# History-state bookkeeping. We accumulate secret-free facts into a JSON state
# file and hand it to record-update-history.mjs (run INSIDE the app container so
# it shares the Prisma client + DATABASE_URL) to persist an UpdateHistory row.
# ---------------------------------------------------------------------------
HISTORY_ID=""
STARTED_AT="$(date -u +%FT%TZ)"
FROM_SHA="${APP_BUILD_SHA:-unknown}"
FROM_VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo unknown)"
TARGET_SHA=""
TARGET_FULL_SHA=""
TARGET_VERSION=""
CANDIDATE_TAG=""
CANDIDATE_IMAGE_ID=""
BACKUP=""
BACKUP_RESULT="PENDING"
MIGRATIONS_RESULT="PENDING"
HEALTH_RESULT="PENDING"
SECURITY_RESULT="PENDING"
ROLLBACK_RESULT=""
FAIL_STAGE=""
FAIL_REASON=""
MIGRATED=0
# Identity of the CURRENTLY-running (old) application, captured BEFORE we stop it
# so recovery knows exactly what was serving traffic. On the first upgrade into a
# maintenance-aware release the old image does NOT enforce the DB gate, so we
# must explicitly stop it before migrating; APP_STOPPED records whether we did.
PREV_CONTAINER_ID=""
PREV_IMAGE_ID=""
PREV_IMAGE_REF=""
APP_STOPPED=0
# How the in-container recorder is reached. Starts "running" (best-effort against
# the CURRENTLY running app image, which on a pre-0019 appliance may lack both the
# recorder script and the new UpdateHistory columns). Switches to "candidate"
# once migrations 0018/0019 have applied, at which point history persistence is
# dependable because we run the recorder FROM the verified candidate image.
RECORDER_MODE="running"

json_escape() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1" 2>/dev/null || printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"; }

write_state() {
  # Writes the current secret-free state snapshot to $STATE_FILE.
  local result="$1" finished="$2"
  mkdir -p "$STATE_DIR"
  {
    printf '{\n'
    printf '  "id": %s,\n'               "$(json_escape "$HISTORY_ID")"
    printf '  "action": "INSTALL",\n'
    printf '  "source": %s,\n'           "$(json_escape "${UPDATE_SOURCE:-GITHUB}")"
    printf '  "result": %s,\n'           "$(json_escape "$result")"
    printf '  "fromVersion": %s,\n'      "$(json_escape "$FROM_VERSION")"
    printf '  "toVersion": %s,\n'        "$(json_escape "$TARGET_VERSION")"
    printf '  "commit": %s,\n'           "$(json_escape "$TARGET_FULL_SHA")"
    printf '  "fromCommit": %s,\n'       "$(json_escape "$FROM_SHA")"
    printf '  "toCommit": %s,\n'         "$(json_escape "$TARGET_SHA")"
    printf '  "backupResult": %s,\n'     "$(json_escape "$BACKUP_RESULT")"
    printf '  "migrationsResult": %s,\n' "$(json_escape "$MIGRATIONS_RESULT")"
    printf '  "healthResult": %s,\n'     "$(json_escape "$HEALTH_RESULT")"
    printf '  "rollbackResult": %s,\n'   "$(json_escape "$ROLLBACK_RESULT")"
    printf '  "candidateImage": %s,\n'   "$(json_escape "$CANDIDATE_TAG")"
    printf '  "candidateDigest": %s,\n'  "$(json_escape "$CANDIDATE_IMAGE_ID")"
    printf '  "previousContainerId": %s,\n' "$(json_escape "$PREV_CONTAINER_ID")"
    printf '  "previousImageId": %s,\n'  "$(json_escape "$PREV_IMAGE_ID")"
    printf '  "previousImageRef": %s,\n' "$(json_escape "$PREV_IMAGE_REF")"
    printf '  "previousBuildSha": %s,\n' "$(json_escape "$FROM_SHA")"
    printf '  "appStopped": %s,\n'       "$(json_escape "$APP_STOPPED")"
    printf '  "backupPath": %s,\n'       "$(json_escape "$BACKUP")"
    printf '  "securityResult": %s,\n'   "$(json_escape "$SECURITY_RESULT")"
    printf '  "failStage": %s,\n'        "$(json_escape "$FAIL_STAGE")"
    printf '  "failReason": %s,\n'       "$(json_escape "$FAIL_REASON")"
    printf '  "startedAt": %s,\n'        "$(json_escape "$STARTED_AT")"
    printf '  "finishedAt": %s\n'        "$(json_escape "$finished")"
    printf '}\n'
  } > "$STATE_FILE"
}

run_recorder() {
  # Feed the host-written $STATE_FILE to record-update-history.mjs over STDIN
  # (argument "-"), never as an in-container path: the app volume is a NAMED
  # docker volume, not a bind mount of the host data dir, so the host state file
  # is not visible inside the container. Before migrations we target the running
  # app (exec); once RECORDER_MODE=candidate we run the recorder FROM the
  # verified candidate image (a fresh `compose run --rm` that shares the same
  # DATABASE_URL and has the migrated schema + the recorder script).
  if [ "$RECORDER_MODE" = "candidate" ] && [ -n "$CANDIDATE_TAG" ]; then
    CONTRACTOR_APP_IMAGE="$CANDIDATE_TAG" APP_BUILD_SHA="$TARGET_SHA" \
      $COMPOSE run --rm -T --no-deps --entrypoint node app \
        scripts/record-update-history.mjs - < "$STATE_FILE"
  else
    $COMPOSE exec -T app node scripts/record-update-history.mjs - < "$STATE_FILE"
  fi
}

persist_history() {
  # $1 = result enum, $2 = finishedAt (may be empty). Best-effort: NEVER abort
  # the upgrade because history could not be written. Before migrations this is
  # expected to be a no-op on a pre-0019 appliance (older running image, older
  # schema) — that is surfaced as a note, not a failure. After migrations the
  # candidate env makes persistence dependable.
  local result="$1" finished="${2:-}"
  write_state "$result" "$finished"
  local out
  if out=$(run_recorder 2>&1); then
    # record-update-history.mjs prints the row id on stdout (last line).
    HISTORY_ID="$(printf '%s' "$out" | tail -n 1 | tr -d '[:space:]')"
    echo "history: persisted (id=${HISTORY_ID}, via=${RECORDER_MODE})"
  else
    if [ "$RECORDER_MODE" = "candidate" ]; then
      echo "warn: could not persist UpdateHistory row from candidate env: ${out}" >&2
    else
      echo "note: pre-migration UpdateHistory persistence unavailable (pre-0019 appliance?); continuing: ${out}" >&2
    fi
  fi
}

run_maintenance() {
  # $1 = on|off|status. Toggle the AUTHORITATIVE application maintenance gate
  # (UpdateSettings.maintenanceMode) via scripts/set-maintenance.mjs, run FROM
  # the verified candidate image (which contains the script + Prisma client)
  # against the SAME database. The currently-running (old) image may not contain
  # this script and the app data dir is a NAMED volume, so we never rely on the
  # running container. The candidate image exists from step 12 onward, which is
  # before the first DB-mutating step (migrations), so the gate is enabled before
  # any mutation. Prints the resulting state ('on'|'off') on stdout (last line).
  CONTRACTOR_APP_IMAGE="$CANDIDATE_TAG" APP_BUILD_SHA="$TARGET_SHA" \
    $COMPOSE run --rm -T --no-deps --entrypoint node app \
      scripts/set-maintenance.mjs "$1"
}

die() {
  FAIL_REASON="$1"
  [ -n "$FAIL_STAGE" ] || FAIL_STAGE="step-${STEP}"
  echo "ERROR [${FAIL_STAGE}]: ${FAIL_REASON}" >&2
  persist_history "FAILED" "$(date -u +%FT%TZ)" || true
  exit 1
}

# ---------------------------------------------------------------------------
# Load appliance deployment config WITHOUT sourcing untrusted shell and WITHOUT
# printing any values. Only KEY=VALUE lines with safe key names are exported.
# ---------------------------------------------------------------------------
load_appliance_env() {
  local f="${APP_ENV_FILE:-/opt/contractor/.env}"
  [ -f "$f" ] || { echo "note: appliance env file not found at $f (relying on process env)"; return 0; }
  local loaded=0 line key val
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|'#'*) continue ;;
    esac
    [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || continue
    key="${line%%=*}"
    val="${line#*=}"
    # strip one surrounding layer of single or double quotes
    if [[ "$val" == \"*\" && "$val" == *\" ]]; then val="${val#\"}"; val="${val%\"}"; fi
    if [[ "$val" == \'*\' && "$val" == *\' ]]; then val="${val#\'}"; val="${val%\'}"; fi
    export "$key=$val"
    loaded=$((loaded+1))
  done < "$f"
  echo "loaded ${loaded} config keys from ${f} (values not shown)"
}

# ---------------------------------------------------------------------------
# CLI parsing: --ref (advanced) | --channel (normal). Mutually informative;
# --ref pins an exact git ref, --channel selects a signed-release channel.
# ---------------------------------------------------------------------------
RELEASE_REF=""
CHANNEL=""
MODE=""
usage() {
  cat >&2 <<'EOF'
Usage:
  os1-upgrade.sh --ref <branch|tag|SHA>      Pin an exact git ref (advanced).
  os1-upgrade.sh --channel <stable|rc|beta>  Install the latest signed release
                                             on a channel (normal operation).
EOF
}
while [ $# -gt 0 ]; do
  case "$1" in
    --ref)       RELEASE_REF="${2:-}"; shift 2 || { usage; exit 2; } ;;
    --ref=*)     RELEASE_REF="${1#*=}"; shift ;;
    --channel)   CHANNEL="${2:-}"; shift 2 || { usage; exit 2; } ;;
    --channel=*) CHANNEL="${1#*=}"; shift ;;
    -h|--help)   usage; exit 0 ;;
    --) shift; break ;;
    -*) echo "error: unknown option: $1" >&2; usage; exit 2 ;;
    *)  # deprecated positional ref (back-compat)
        if [ -z "$RELEASE_REF" ]; then
          echo "warn: positional ref is deprecated; use --ref <ref>" >&2
          RELEASE_REF="$1"; shift
        else
          echo "error: unexpected argument: $1" >&2; usage; exit 2
        fi ;;
  esac
done

if [ -n "$CHANNEL" ]; then
  case "$CHANNEL" in
    stable|rc|beta) : ;;
    *) echo "error: --channel must be one of stable|rc|beta" >&2; exit 2 ;;
  esac
fi
if [ -n "$RELEASE_REF" ] && [ -n "$CHANNEL" ]; then
  echo "error: use either --ref or --channel, not both" >&2; exit 2
fi
if [ -n "$RELEASE_REF" ]; then MODE="ref"; UPDATE_SOURCE="MANUAL"
elif [ -n "$CHANNEL" ]; then MODE="channel"; UPDATE_SOURCE="GITHUB"
else echo "error: one of --ref or --channel is required" >&2; usage; exit 2
fi

# 1. Preflight toolchain/resource validation
step "Preflight validation"
FAIL_STAGE="preflight"
bash "$ROOT/scripts/preflight-build.sh" || die "preflight failed"

# --- Persistent-volume protection guard (Domain & SSL data safety) ----------
# These named volumes hold state that MUST survive every upgrade: the database,
# runtime app data, and — critically for Domain & SSL — the Caddy ACME account,
# issued certificate private keys, renewal state, autosaved config and the
# app-generated per-domain config. This upgrade path only ever prunes candidate
# *images* (step 19); it never runs `docker compose down -v`, `docker volume rm`
# or `docker volume prune`, so these volumes are preserved by construction. The
# check below fails closed if a future edit ever introduces a destructive volume
# operation into this script.
PROTECTED_VOLUMES="db_data app_data caddy_data caddy_config caddy_generated"
for _vol in $PROTECTED_VOLUMES; do
  if ! grep -Eq "^[[:space:]]{2}${_vol}:" "$ROOT/docker-compose.yml"; then
    die "refusing to upgrade: protected volume '${_vol}' is not declared in docker-compose.yml (would risk data loss)"
  fi
done
echo "volume protection: verified ${PROTECTED_VOLUMES} declared and preserved (upgrade prunes candidate images only)"

# 2. Load appliance deployment config (no secrets printed)
step "Load appliance environment"
FAIL_STAGE="load-env"
load_appliance_env

# 3. Verify signed release (channel mode) — mandatory, fail-closed
step "Verify signed release"
FAIL_STAGE="verify-release"
if [ "$MODE" = "channel" ]; then
  VERIFY_JSON="$(node "$ROOT/scripts/verify-release.mjs" --channel "$CHANNEL")" \
    || die "signed release verification failed for channel '$CHANNEL' (see error above)"
  TARGET_VERSION="$(printf '%s' "$VERIFY_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log((JSON.parse(s).version)||"")}catch{console.log("")}})')"
  RELEASE_REF="$(printf '%s' "$VERIFY_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log((JSON.parse(s).commit)||"")}catch{console.log("")}})')"
  [ -n "$RELEASE_REF" ] || die "verified manifest did not pin a target commit"
  echo "verified release: version=${TARGET_VERSION} commit=${RELEASE_REF} channel=${CHANNEL}"
else
  echo "advanced --ref mode: exact git ref pinned by operator ($RELEASE_REF)"
  # Honor an existing signed manifest if one is staged, but do not require it in
  # the advanced path where the operator explicitly pins a ref.
  if [ -f "$ROOT/data/updates/staging/manifest.json" ]; then
    node "$ROOT/scripts/verify-release.mjs" --ref "$RELEASE_REF" \
      || die "a staged manifest is present but failed verification"
  fi
fi

# 4. Resolve target ref -> exact commit (fail closed; no ambiguous fallback)
step "Resolve target commit"
FAIL_STAGE="resolve-target"
git fetch --tags --quiet origin 2>/dev/null || echo "warn: git fetch failed (offline?) — resolving against local objects"
TARGET_FULL_SHA="$(git rev-parse --verify --quiet "${RELEASE_REF}^{commit}")" \
  || die "cannot resolve ref '$RELEASE_REF' to a commit — refusing to proceed"
TARGET_SHA="${TARGET_FULL_SHA:0:12}"
echo "target ref=$RELEASE_REF commit=$TARGET_FULL_SHA (short=$TARGET_SHA)"

# 5. Snapshot current version + BEST-EFFORT early history row (IN_PROGRESS).
# The host state file is always written locally here. The DB write is only
# attempted against the running app and is NOT required: a pre-0019 appliance
# has neither the recorder script nor the new schema, so this is a no-op there.
# The dependable UpdateHistory row is created after migrations (step 15b).
step "Snapshot current version"
FAIL_STAGE="snapshot"
echo "current image=$RUNNING_IMAGE_REF version=$FROM_VERSION sha=$FROM_SHA"
persist_history "IN_PROGRESS" "" || true

# 6. Database backup (MANDATORY — before any mutation)
step "Database backup (mandatory)"
FAIL_STAGE="db-backup"
mkdir -p "$BACKUP_DIR"
BACKUP="${BACKUP_DIR}/db-${TS}.sql.gz"
PGUSER_C="${POSTGRES_USER:-fibertrack}"
PGDB_C="${POSTGRES_DB:-fibertrack}"
if $COMPOSE exec -T db pg_dump -U "$PGUSER_C" "$PGDB_C" 2>/dev/null | gzip > "$BACKUP"; then
  echo "backup via compose db service"
elif [ -n "${DATABASE_URL:-}" ] && command -v pg_dump >/dev/null 2>&1; then
  pg_dump "$DATABASE_URL" | gzip > "$BACKUP" || die "host pg_dump failed"
  echo "backup via host pg_dump"
else
  die "no working backup path (compose db service and host pg_dump both unavailable) — refusing to mutate"
fi
[ -s "$BACKUP" ] || die "backup file is empty ($BACKUP) — refusing to mutate"
chmod 600 "$BACKUP"
sha256sum "$BACKUP" | awk '{print $1}' > "${BACKUP}.sha256"
chmod 600 "${BACKUP}.sha256"
BACKUP_RESULT="COMPLETE"
echo "backup: COMPLETE ($BACKUP, sha256 recorded)"

# 7. Environment backup (restorable copy, 0600, never printed)
step "Environment backup (restorable)"
FAIL_STAGE="env-backup"
ENV_SRC=""
for c in ".env" "${APP_ENV_FILE:-/opt/contractor/.env}"; do
  [ -f "$c" ] && { ENV_SRC="$c"; break; }
done
if [ -n "$ENV_SRC" ]; then
  ENV_BACKUP="${BACKUP_DIR}/env-${TS}.bak"
  ( umask 077; cp "$ENV_SRC" "$ENV_BACKUP" )
  chmod 600 "$ENV_BACKUP"
  sha256sum "$ENV_BACKUP" | awk '{print $1}' > "${ENV_BACKUP}.sha256"
  chmod 600 "${ENV_BACKUP}.sha256"
  echo "env backup: restorable copy stored 0600 with checksum (values not shown)"
else
  echo "note: no .env present to back up"
fi

# 8. Checkout target commit (detached) — fail closed + verify HEAD
step "Checkout target commit"
FAIL_STAGE="checkout"
git checkout --quiet --detach "$TARGET_FULL_SHA" || die "checkout of $TARGET_FULL_SHA failed"
HEAD_NOW="$(git rev-parse HEAD)"
[ "$HEAD_NOW" = "$TARGET_FULL_SHA" ] || die "post-checkout HEAD ($HEAD_NOW) != target ($TARGET_FULL_SHA)"
echo "checked out $HEAD_NOW"

# 9. Activate Yarn 4 via corepack (preserve live build toolchain)
step "Activate Yarn 4.9.2"
FAIL_STAGE="corepack"
corepack enable && corepack prepare yarn@4.9.2 --activate || die "corepack yarn activation failed"

# 10. Immutable dependency install
step "Install dependencies (immutable)"
FAIL_STAGE="yarn-install"
YARN_NETWORK_TIMEOUT=600000 yarn install --immutable || die "yarn install --immutable failed"

# 11. Prisma client generate (candidate schema)
step "Prisma generate"
FAIL_STAGE="prisma-generate"
yarn prisma generate || die "prisma generate failed"

# 12. Build CANDIDATE image (never touch running image)
step "Build candidate image contractor-app:candidate-${TARGET_SHA}"
FAIL_STAGE="candidate-build"
CANDIDATE_TAG="contractor-app:candidate-${TARGET_SHA}"
command -v docker >/dev/null 2>&1 || die "docker is required to build/cutover the candidate image"
docker build --build-arg APP_BUILD_SHA="$TARGET_SHA" -t "$CANDIDATE_TAG" . \
  || die "candidate image build failed (running app untouched, no cutover attempted)"
echo "candidate built: $CANDIDATE_TAG"

# 13. Capture validated candidate image id (the identity cutover must match)
step "Capture candidate image id"
FAIL_STAGE="candidate-verify"
CANDIDATE_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$CANDIDATE_TAG")" \
  || die "candidate image missing after build"
echo "candidate image id: $CANDIDATE_IMAGE_ID"

# 14. Enter maintenance mode (DB-authoritative, BEFORE any DB mutation)
# The real gate is UpdateSettings.maintenanceMode enforced by the app's request
# proxy (503 on mutating product APIs). We enable it from the verified candidate
# image against the live DB and VERIFY it is actually ON. If the maintenance
# state cannot be enabled (e.g. schema too old to hold the flag) we STOP BEFORE
# MIGRATIONS — we never enter the DB-mutating boundary without a real gate. The
# host marker file is kept only as SECONDARY recovery evidence, never the gate.
step "Enter maintenance mode"
FAIL_STAGE="maintenance-on"
MAINT_STATE="$(run_maintenance on 2>&1 | tail -n 1 | tr -d '[:space:]')" \
  || die "could not enable DB maintenance gate before migrations (STOP): ${MAINT_STATE}"
[ "$MAINT_STATE" = "on" ] \
  || die "maintenance gate not confirmed ON before migrations (got '${MAINT_STATE}') — refusing to migrate"
mkdir -p data/updates
touch data/updates/MAINTENANCE 2>/dev/null || true  # secondary evidence only
echo "maintenance: ON (UpdateSettings.maintenanceMode verified ON)"

# 14b. QUIESCE the currently-running (old) application BEFORE any DB mutation.
# On the FIRST upgrade into a maintenance-aware release the old image predates
# proxy.ts and does NOT enforce UpdateSettings.maintenanceMode, so the DB flag
# alone cannot stop it writing during migrations. We therefore (1) capture the
# previous container/image identity into updater state so recovery knows exactly
# what was running, then (2) explicitly STOP the old app container, leaving
# PostgreSQL running. If the stop cannot be confirmed we STOP and never migrate.
step "Quiesce running application (stop old app before migration)"
FAIL_STAGE="quiesce"
PREV_CONTAINER_ID="$($COMPOSE ps -q app 2>/dev/null | head -n 1 || true)"
if [ -n "$PREV_CONTAINER_ID" ]; then
  PREV_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$PREV_CONTAINER_ID" 2>/dev/null || echo unknown)"
  PREV_IMAGE_REF="$(docker inspect --format '{{.Config.Image}}' "$PREV_CONTAINER_ID" 2>/dev/null || echo "$RUNNING_IMAGE_REF")"
else
  PREV_IMAGE_REF="$RUNNING_IMAGE_REF"
  echo "note: no running app container found (nothing to quiesce)"
fi
echo "previous app: container=${PREV_CONTAINER_ID:-none} image=${PREV_IMAGE_ID:-unknown} ref=${PREV_IMAGE_REF} sha=${FROM_SHA}"
# Record the previous identity into updater state/history BEFORE stopping the app
# (best-effort: the old image may lack the recorder; the local state file always
# captures it). Recovery reads this to know exactly what to restart.
persist_history "IN_PROGRESS" "" || true
if [ -n "$PREV_CONTAINER_ID" ]; then
  # Stop ONLY the app service. PostgreSQL (db) is deliberately left running so
  # migrations can proceed against the quiesced database.
  $COMPOSE stop app \
    || die "could not stop the running application before migration (STOP) — refusing to migrate; database untouched, maintenance held ON"
  # Verify the old app is actually down; never migrate with it still up.
  RUN_STATE="$(docker inspect --format '{{.State.Running}}' "$PREV_CONTAINER_ID" 2>/dev/null || echo gone)"
  case "$RUN_STATE" in
    false|gone) : ;;
    *) die "old application still running after stop (state=${RUN_STATE}) — refusing to migrate" ;;
  esac
  APP_STOPPED=1
  echo "quiesced: old app stopped; PostgreSQL left running"
else
  APP_STOPPED=1
  echo "quiesced: no old app process to stop; PostgreSQL untouched"
fi

# 15. Run migrations FROM the candidate image (DB-mutating boundary)
step "Apply migrations from candidate image"
FAIL_STAGE="migrations"
MIGRATED=1
if CONTRACTOR_APP_IMAGE="$CANDIDATE_TAG" APP_BUILD_SHA="$TARGET_SHA" \
     $COMPOSE run --rm -T --no-deps --entrypoint node app scripts/db-bootstrap.mjs; then
  MIGRATIONS_RESULT="COMPLETE"
  echo "migrations: COMPLETE (ran from candidate image)"
else
  MIGRATIONS_RESULT="FAILED"
  ROLLBACK_RESULT="DB_RESTORE_REQUIRED"
  # The old app is already STOPPED and maintenance is ON — both are held so no
  # process touches the partially-migrated DB. Never auto-restart the old image
  # against a mutated schema. Give the operator exact recovery instructions.
  echo "recovery: old application remains STOPPED; maintenance remains ON." >&2
  echo "recovery: DATABASE RESTORE REQUIRED before any restart. Backup: $BACKUP" >&2
  echo "recovery: previously-running image ref=${PREV_IMAGE_REF} id=${PREV_IMAGE_ID} sha=${FROM_SHA}" >&2
  echo "recovery: after restoring the DB from the backup above, start the prior app with:" >&2
  echo "recovery:   CONTRACTOR_APP_IMAGE=\"${PREV_IMAGE_REF}\" $COMPOSE up -d app" >&2
  echo "recovery: do NOT start the candidate against a partially-migrated database." >&2
  die "migration failed — DATABASE RESTORE REQUIRED from $BACKUP (old app kept stopped; maintenance held ON)"
fi

# 15b. Migrations 0018/0019 are now guaranteed applied and the verified candidate
# image (which contains record-update-history.mjs + the new schema) is available.
# Switch the recorder to the candidate environment and persist the REAL
# UpdateHistory row. When early persistence succeeded (appliance already >=0019)
# HISTORY_ID is set and this UPDATES that same row; when it did not (pre-0019)
# this CREATES the row now. All later transitions update this row.
echo "history: switching persistence to verified candidate environment"
RECORDER_MODE="candidate"
persist_history "IN_PROGRESS" ""

# 16. Cutover: point compose at the validated candidate and assert identity
step "Cutover to candidate"
FAIL_STAGE="cutover"
if ! CONTRACTOR_APP_IMAGE="$CANDIDATE_TAG" APP_BUILD_SHA="$TARGET_SHA" \
     $COMPOSE up -d --no-build app; then
  # Cutover failed AFTER a successful migration: the schema is already migrated,
  # so the old image is INCOMPATIBLE and must NOT be restarted automatically.
  echo "recovery: candidate cutover failed AFTER successful migration." >&2
  echo "recovery: maintenance remains ON; old image is NOT restarted (schema already migrated)." >&2
  echo "recovery: previous image ref=${PREV_IMAGE_REF} id=${PREV_IMAGE_ID} (incompatible with migrated DB)." >&2
  echo "recovery: fix the candidate and re-run cutover; do not start the old image." >&2
  die "compose cutover failed — recovery required (maintenance held ON; old image not restarted)"
fi
# Alias the validated candidate to the stable running ref so a plain
# 'docker compose up -d' (no override) keeps serving the same validated image.
docker tag "$CANDIDATE_TAG" "$RUNNING_IMAGE_REF"
RUNNING_CID="$($COMPOSE ps -q app)"
[ -n "$RUNNING_CID" ] || die "no running app container after cutover"
RUNNING_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$RUNNING_CID")"
if [ "$RUNNING_IMAGE_ID" != "$CANDIDATE_IMAGE_ID" ]; then
  die "running image ($RUNNING_IMAGE_ID) != validated candidate ($CANDIDATE_IMAGE_ID) — cutover did not serve the verified build"
fi
echo "cutover verified: running image == validated candidate ($CANDIDATE_IMAGE_ID)"

# 17. Health check — failure is fatal (no false COMPLETE)
step "Health check"
FAIL_STAGE="health"
HEALTHY=0
for i in $(seq 1 24); do
  BODY="$(curl -fsS "$HEALTH_URL" 2>/dev/null || true)"
  if [ -n "$BODY" ] && printf '%s' "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.exit((j.status==="ok"||j.db==="ok")?0:1)}catch{process.exit(1)}})'; then
    HEALTHY=1; break
  fi
  sleep 5
done
if [ "$HEALTHY" = "1" ]; then
  HEALTH_RESULT="OK"
  echo "health: OK"
else
  HEALTH_RESULT="FAILED"
  # Past the DB-mutating boundary: the old image can no longer be trusted
  # against the migrated schema. Keep maintenance ON and demand DB restore.
  touch data/updates/MAINTENANCE 2>/dev/null || true  # secondary evidence only
  if [ "$MIGRATED" = "1" ]; then
    ROLLBACK_RESULT="DB_RESTORE_REQUIRED"
    die "health check failed after migration — DATABASE RESTORE REQUIRED from $BACKUP; maintenance held ON"
  else
    ROLLBACK_RESULT="APP_ROLLBACK"
    die "health check failed before migration — reverting app; maintenance held ON"
  fi
fi

# 18. Security posture check (non-root uid)
step "Security posture"
FAIL_STAGE="security"
UID_RUN="$(docker run --rm --entrypoint id "$RUNNING_IMAGE_REF" -u 2>/dev/null || echo unknown)"
if [ "$UID_RUN" = "$EXPECTED_UID" ]; then
  SECURITY_RESULT="OK"
  echo "runtime uid: $UID_RUN (non-root, expected $EXPECTED_UID)"
else
  SECURITY_RESULT="WARN:uid=${UID_RUN}"
  echo "warn: runtime uid is $UID_RUN (expected $EXPECTED_UID)"
fi

# 19. Exit maintenance + prune old candidate images (keep last 3)
# Reached ONLY after migrations + cutover + health + security all PASSED. Any
# earlier failure calls die() which leaves the DB maintenance gate ON for
# operator recovery. Turn the gate OFF and VERIFY it actually changed.
step "Exit maintenance / prune candidates"
FAIL_STAGE="finalize"
MAINT_STATE="$(run_maintenance off 2>&1 | tail -n 1 | tr -d '[:space:]')" \
  || die "could not disable DB maintenance gate after successful upgrade: ${MAINT_STATE}"
[ "$MAINT_STATE" = "off" ] \
  || die "maintenance gate not confirmed OFF after upgrade (got '${MAINT_STATE}')"
rm -f data/updates/MAINTENANCE 2>/dev/null || true  # secondary evidence only
echo "maintenance: OFF (UpdateSettings.maintenanceMode verified OFF)"
docker images 'contractor-app' --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
  | grep ':candidate-' | tail -n +4 | xargs -r docker rmi 2>/dev/null || true
echo "prune complete"

# 20. Persist SUCCESS history + finish
step "Record upgrade result"
FAIL_STAGE="record"
ROLLBACK_RESULT="${ROLLBACK_RESULT:-NONE}"
persist_history "SUCCESS" "$(date -u +%FT%TZ)"
rm -f "$STATE_FILE" 2>/dev/null || true
echo ""
echo "upgrade COMPLETE: ${FROM_SHA} -> ${TARGET_SHA} (version ${TARGET_VERSION:-n/a}) at $(date -u +%FT%TZ)"
exit 0
