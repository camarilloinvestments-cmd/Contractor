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
    printf '  "backupPath": %s,\n'       "$(json_escape "$BACKUP")"
    printf '  "securityResult": %s,\n'   "$(json_escape "$SECURITY_RESULT")"
    printf '  "failStage": %s,\n'        "$(json_escape "$FAIL_STAGE")"
    printf '  "failReason": %s,\n'       "$(json_escape "$FAIL_REASON")"
    printf '  "startedAt": %s,\n'        "$(json_escape "$STARTED_AT")"
    printf '  "finishedAt": %s\n'        "$(json_escape "$finished")"
    printf '}\n'
  } > "$STATE_FILE"
}

persist_history() {
  # $1 = result enum, $2 = finishedAt (may be empty). Best-effort: never abort
  # the upgrade because history could not be written, but surface the failure.
  local result="$1" finished="${2:-}"
  write_state "$result" "$finished"
  local out
  if out=$($COMPOSE exec -T app node scripts/record-update-history.mjs "$STATE_FILE" 2>&1); then
    # record-update-history.mjs prints the row id on stdout (last line).
    HISTORY_ID="$(printf '%s' "$out" | tail -n 1 | tr -d '[:space:]')"
    echo "history: persisted (id=${HISTORY_ID})"
  else
    echo "warn: could not persist UpdateHistory row: ${out}" >&2
  fi
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

# 5. Snapshot current version + open history row (IN_PROGRESS)
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

# 14. Enter maintenance mode
step "Enter maintenance mode"
FAIL_STAGE="maintenance-on"
mkdir -p data/updates
touch data/updates/MAINTENANCE 2>/dev/null || true
echo "maintenance: ON"

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
  die "migration failed — DATABASE RESTORE REQUIRED from $BACKUP (restore before retrying)"
fi

# 16. Cutover: point compose at the validated candidate and assert identity
step "Cutover to candidate"
FAIL_STAGE="cutover"
CONTRACTOR_APP_IMAGE="$CANDIDATE_TAG" APP_BUILD_SHA="$TARGET_SHA" \
  $COMPOSE up -d --no-build app || die "compose cutover failed"
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
  touch data/updates/MAINTENANCE 2>/dev/null || true
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
step "Exit maintenance / prune candidates"
FAIL_STAGE="finalize"
rm -f data/updates/MAINTENANCE 2>/dev/null || true
echo "maintenance: OFF"
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
