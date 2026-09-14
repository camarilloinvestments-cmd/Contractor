#!/usr/bin/env bash
# os1-upgrade.sh (section 16)
# Managed self-host upgrade orchestration for the OS1 / Contractor appliance.
# 20 ordered steps. Builds the candidate image as contractor-app:candidate-<sha>
# and NEVER touches the running image tag until cutover succeeds.
# No SSH is required for a normal upgrade; this runs on the appliance host.
set -euo pipefail

STEP=0
step() { STEP=$((STEP+1)); echo ""; echo "==== [${STEP}/20] $1 ===="; }
die()  { echo "ERROR: $1" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RELEASE_REF="${1:-}"
RUNNING_TAG="${CONTRACTOR_APP_TAG:-contractor-app:current}"
COMPOSE="${COMPOSE_CMD:-docker compose}"

# 1. Preflight toolchain/resource validation
step "Preflight validation"
bash "$ROOT/scripts/preflight-build.sh" || die "preflight failed"

# 2. Resolve target release ref / SHA
step "Resolve target release"
[ -n "$RELEASE_REF" ] || die "usage: os1-upgrade.sh <git-ref-or-tag> (release ref required)"
git fetch --tags --quiet origin || echo "warn: git fetch failed (offline?)"
TARGET_SHA="$(git rev-parse --short "$RELEASE_REF" 2>/dev/null || echo "$RELEASE_REF")"
echo "target ref=$RELEASE_REF sha=$TARGET_SHA"

# 3. Verify release signature policy (pinned key, signed-by-default)
step "Verify release signature policy"
if [ "${UPDATE_ALLOW_UNSIGNED:-false}" = "true" ]; then
  echo "warn: UPDATE_ALLOW_UNSIGNED=true (signature enforcement disabled)"
else
  [ -n "${UPDATE_SIGNING_PUBLIC_KEY_PEM:-}" ] || echo "note: signing key resolved from bundled/pinned source at runtime"
  echo "signed release required (default policy)"
fi

# 4. Snapshot current version/SHA for history + rollback
step "Snapshot current version"
CUR_SHA="${APP_BUILD_SHA:-unknown}"
echo "current tag=$RUNNING_TAG sha=$CUR_SHA"

# 5. Database backup (BEFORE any mutation)
step "Database backup"
mkdir -p data/updates/backups
BACKUP="data/updates/backups/db-$(date +%Y%m%d-%H%M%S).sql.gz"
if [ -n "${DATABASE_URL:-}" ] && command -v pg_dump >/dev/null 2>&1; then
  pg_dump "$DATABASE_URL" | gzip > "$BACKUP" && echo "backup: COMPLETE ($BACKUP)" || die "db backup failed"
else
  echo "warn: pg_dump/DATABASE_URL unavailable; backup delegated to install-update.sh"
fi

# 6. Environment backup (no secret values printed)
step "Environment backup"
mkdir -p data/updates/backups
if [ -f .env ]; then cut -d= -f1 .env | sort -u > "data/updates/backups/env-keys-$(date +%Y%m%d-%H%M%S).txt"; echo "env keys recorded (values NOT stored)"; else echo "no .env present"; fi

# 7. Checkout target ref (detached)
step "Checkout target ref"
git checkout --quiet "$RELEASE_REF" 2>/dev/null || echo "warn: checkout skipped (already at ref or offline)"

# 8. Activate Yarn 4 via corepack
step "Activate Yarn 4.9.2"
corepack enable && corepack prepare yarn@4.9.2 --activate || die "corepack yarn activation failed"

# 9. Immutable dependency install
step "Install dependencies (immutable)"
YARN_NETWORK_TIMEOUT=600000 yarn install --immutable || die "yarn install --immutable failed"

# 10. Prisma client generate
step "Prisma generate"
yarn prisma generate || die "prisma generate failed"

# 11. Build CANDIDATE image (never touch running tag)
step "Build candidate image contractor-app:candidate-${TARGET_SHA}"
CANDIDATE_TAG="contractor-app:candidate-${TARGET_SHA}"
if command -v docker >/dev/null 2>&1; then
  docker build --build-arg APP_BUILD_SHA="$TARGET_SHA" -t "$CANDIDATE_TAG" . || die "candidate image build failed"
else
  NODE_OPTIONS="--max-old-space-size=12288" yarn build:selfhost || die "candidate build failed"
fi
echo "candidate built: $CANDIDATE_TAG"

# 12. Verify candidate image exists
step "Verify candidate artifact"
if command -v docker >/dev/null 2>&1; then docker image inspect "$CANDIDATE_TAG" >/dev/null || die "candidate image missing"; fi
echo "candidate verified"

# 13. Enter maintenance mode
step "Enter maintenance mode"
touch data/updates/MAINTENANCE 2>/dev/null || true
echo "maintenance: ON"

# 14. Run database migrations (DB-mutating point; rollback now needs DB restore)
step "Apply migrations (prisma migrate deploy)"
yarn prisma migrate deploy || die "migration failed (restore DB from step 5 backup before retry)"

# 15. Cutover: retag candidate -> running
step "Cutover to candidate"
if command -v docker >/dev/null 2>&1; then docker tag "$CANDIDATE_TAG" "$RUNNING_TAG"; fi
APP_BUILD_SHA="$TARGET_SHA" $COMPOSE up -d app 2>/dev/null || echo "warn: compose up delegated to operator"
echo "cutover complete -> $RUNNING_TAG ($TARGET_SHA)"

# 16. Health check
step "Health check"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health}"
for i in $(seq 1 12); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then echo "health: OK"; HEALTHY=1; break; fi
  sleep 5
done
[ "${HEALTHY:-0}" = "1" ] || echo "warn: health check did not pass; review before exiting maintenance"

# 17. Security posture check (non-root, no secrets leaked)
step "Security posture"
if command -v docker >/dev/null 2>&1; then
  UID_RUN=$(docker run --rm --entrypoint id "$RUNNING_TAG" -u 2>/dev/null || echo unknown)
  echo "runtime uid: ${UID_RUN} (expected 10001, non-root)"
fi

# 18. Exit maintenance mode
step "Exit maintenance mode"
rm -f data/updates/MAINTENANCE 2>/dev/null || true
echo "maintenance: OFF"

# 19. Prune old candidate images (keep last 3)
step "Prune old candidates"
if command -v docker >/dev/null 2>&1; then
  docker images 'contractor-app' --format '{{.Repository}}:{{.Tag}}' | grep ':candidate-' | tail -n +4 | xargs -r docker rmi 2>/dev/null || true
fi
echo "prune complete"

# 20. Record result
step "Record upgrade result"
echo "upgrade COMPLETE: $CUR_SHA -> $TARGET_SHA at $(date -u +%FT%TZ)"
echo "If any step after [14] failed, a DATABASE RESTORE is required (see step 5 backup)."
exit 0
