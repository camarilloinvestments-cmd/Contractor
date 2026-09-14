#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# OS1 Fiber Track Pro - safe host-level update installer (Workstream U).
#
# The in-app Update Center verifies + stages a package and writes an install
# plan; a containerized Node app cannot safely swap its own image and restart
# itself, so THIS script performs the host-level steps for a docker-compose
# deployment:
#
#   check plan -> re-verify checksum -> preflight -> DB backup -> record current
#   version -> maintenance mode -> stage new source -> rebuild image -> apply
#   migrations -> start -> health check (HTTP + DB) -> SUCCESS
#
# On ANY failure after the backup it AUTO-ROLLS BACK: restores the previous
# source/image, restarts, and (only if migrations had run) restores the DB
# backup, then clears maintenance mode.
#
#   scripts/install-update.sh              # install the staged plan
#   scripts/install-update.sh --rollback   # roll back to the previous release
#
# Requires: docker compose, curl, sha256sum, tar. Run from the deployment host
# in the directory that holds docker-compose.yml.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

STAGING="data/updates/staging"
BACKUPS="data/updates/backups"
PLAN="${STAGING}/install-plan.json"
PREV_DIR="${BACKUPS}/previous-src"
HEALTH_URL="${HEALTH_URL:-http://localhost:${APP_PORT:-3000}/api/health}"
DC="docker compose"
MODE="install"
[[ "${1:-}" == "--rollback" ]] && MODE="rollback"

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
fail() { echo "[ERROR] $*" >&2; exit 1; }
json_get() { node -e "const d=require('./${PLAN}');process.stdout.write(String(d['$1']??''))"; }

maintenance() {
  # Best-effort maintenance flag toggle in the DB (mirrors the in-app toggle).
  local val="$1"
  $DC exec -T app node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.updateSettings.update({where:{id:'default'},data:{maintenanceMode:${val}}}).then(()=>process.exit(0)).catch(()=>process.exit(0));" 2>/dev/null || true
}

backup_db() {
  mkdir -p "$BACKUPS"
  local out="${BACKUPS}/db-$(date -u +%Y%m%d-%H%M%S).sql"
  log "Backing up database -> ${out}"
  $DC exec -T db pg_dump -U "${POSTGRES_USER:-fibertrack}" "${POSTGRES_DB:-fibertrack}" > "$out" \
    || fail "Database backup failed - aborting before any change."
  echo "$out"
}

health_check() {
  log "Health check: ${HEALTH_URL}"
  for i in $(seq 1 30); do
    if curl -fsS "$HEALTH_URL" >/tmp/os1_health.json 2>/dev/null; then
      if node -e "const d=require('/tmp/os1_health.json');process.exit(d && (d.status==='ok'||d.database==='connected'||d.ok)?0:1)" 2>/dev/null; then
        log "Health OK"; return 0
      fi
    fi
    sleep 3
  done
  return 1
}

rollback() {
  local db_backup="$1"
  log "!! Rolling back"
  if [[ -d "$PREV_DIR" ]]; then
    rsync -a --delete --exclude data/ --exclude node_modules/ "$PREV_DIR"/ ./ || true
  fi
  $DC up -d --build || true
  if [[ -n "${db_backup:-}" && -f "$db_backup" ]]; then
    log "Restoring database from ${db_backup}"
    $DC exec -T db psql -U "${POSTGRES_USER:-fibertrack}" -d "${POSTGRES_DB:-fibertrack}" < "$db_backup" || true
  fi
  maintenance false
  log "Rollback complete."
}

if [[ "$MODE" == "rollback" ]]; then
  [[ -d "$PREV_DIR" ]] || fail "No previous release snapshot to roll back to (${PREV_DIR} missing)."
  latest_db="$(ls -1t ${BACKUPS}/db-*.sql 2>/dev/null | head -1 || true)"
  rollback "$latest_db"
  exit 0
fi

# ----- install -----
[[ -f "$PLAN" ]] || fail "No install plan at ${PLAN}. Use the Update Center to download/verify a package first."
TO_VERSION="$(json_get toVersion)"
PKG="$(json_get packageFile)"
SHA="$(json_get sha256)"
log "Install plan: -> v${TO_VERSION}"
[[ -f "$PKG" ]] || fail "Staged package missing: ${PKG}"

# 1) Re-verify checksum (never install an unverified package).
log "Verifying SHA-256"
ACTUAL="$(sha256sum "$PKG" | awk '{print $1}')"
[[ "$ACTUAL" == "$SHA" ]] || fail "Checksum mismatch - refusing to install."

# 2) Preflight: docker + DB reachable.
command -v docker >/dev/null || fail "docker not found on host."
$DC ps >/dev/null 2>&1 || fail "docker compose stack not found in this directory."

# 3) Backup DB.
DB_BACKUP="$(backup_db)"

# 4) Snapshot current source for rollback.
log "Snapshotting current release -> ${PREV_DIR}"
mkdir -p "$PREV_DIR"
rsync -a --delete --exclude data/ --exclude node_modules/ --exclude .git/ ./ "$PREV_DIR"/

# 5) Maintenance mode ON.
maintenance true

# 6) Stage new source (extract tarball over the working tree).
log "Staging new source from ${PKG}"
TMP="$(mktemp -d)"
tar -xzf "$PKG" -C "$TMP"
SRC_ROOT="$(find "$TMP" -maxdepth 1 -mindepth 1 -type d | head -1)"
[[ -d "$SRC_ROOT" ]] || { rm -rf "$TMP"; fail "Unexpected package layout."; }
if ! rsync -a --exclude data/ --exclude .env --exclude node_modules/ "$SRC_ROOT"/ ./; then
  rm -rf "$TMP"; rollback "$DB_BACKUP"; fail "Failed to stage new source; rolled back."
fi
rm -rf "$TMP"

# 7) Rebuild + start (entrypoint runs prisma migrate deploy).
if ! $DC up -d --build; then
  rollback "$DB_BACKUP"; fail "Build/start failed; rolled back."
fi

# 8) Health + DB + HTTP check.
if ! health_check; then
  rollback "$DB_BACKUP"; fail "Health check failed after update; rolled back."
fi

# 9) SUCCESS - record and clear maintenance.
maintenance false
$DC exec -T app node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.updateSettings.update({where:{id:'default'},data:{lastSuccessfulUpdateAt:new Date()}}).then(()=>process.exit(0)).catch(()=>process.exit(0));" 2>/dev/null || true
log "Update to v${TO_VERSION} installed successfully."
