#!/usr/bin/env bash
# apply-canonical-url.sh — host-side CONTROLLED activation of a new canonical
# application URL (NEXTAUTH_URL).
#
# Writing the canonical URL (scripts/set-app-url.mjs) only STAGES the change to
# the persisted app-url.env fragment; the running Next.js process keeps serving
# the old NEXTAUTH_URL until it is restarted. This script performs the restart
# as a controlled, self-healing operation:
#
#   1. stage the new URL              (set-app-url.mjs --apply <host>)
#   2. restart ONLY the app service   (docker compose up -d --no-deps app)
#   3. poll /api/health until healthy (bounded retries)
#   4. on failure: roll back the fragment (set-app-url.mjs --rollback) and
#      restart again so the appliance is never stranded on a broken URL.
#
# It NEVER runs `docker compose down`, never touches volumes, and never prints
# secrets. The only variable input is the already-validated hostname, which is
# re-validated by set-app-url.mjs before anything is written.
#
# Usage:  scripts/apply-canonical-url.sh <hostname>
#         scripts/apply-canonical-url.sh --rollback
#
# Env overrides (all optional):
#   COMPOSE_CMD   docker compose invocation      (default: docker compose)
#   HEALTH_URL    health endpoint to poll        (default: http://localhost:3000/api/health)
#   APP_SERVICE   compose service name for app   (default: app)
#   HEALTH_RETRIES / HEALTH_INTERVAL             (default: 30 / 2s)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE="${COMPOSE_CMD:-docker compose}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health}"
APP_SERVICE="${APP_SERVICE:-app}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-2}"
SETTER="node scripts/set-app-url.mjs"

log() { echo "apply-canonical-url: $*"; }
die() { echo "apply-canonical-url: ERROR: $*" >&2; exit 1; }

restart_app() {
  # Recreate ONLY the app service; --no-deps leaves db/proxy untouched, and we
  # never pass -v so no volume is ever removed.
  log "restarting service '${APP_SERVICE}' (no deps, no volume changes)"
  ${COMPOSE} up -d --no-deps "${APP_SERVICE}"
}

wait_healthy() {
  local i=0
  while [ "$i" -lt "$HEALTH_RETRIES" ]; do
    if curl -fsS -o /dev/null --max-time 5 "$HEALTH_URL" 2>/dev/null; then
      log "health check passed (${HEALTH_URL})"
      return 0
    fi
    i=$((i+1))
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

rollback() {
  log "rolling back canonical URL to the previous value"
  if ${SETTER} --rollback; then
    restart_app || die "rollback restart failed — appliance needs manual attention"
    if wait_healthy; then
      log "rollback complete; app healthy on the previous canonical URL"
      return 0
    fi
  fi
  die "rollback failed to restore a healthy app — manual attention required"
}

if [ "${1:-}" = "--rollback" ]; then
  rollback
  exit 0
fi

HOST="${1:-}"
[ -n "$HOST" ] || die "usage: apply-canonical-url.sh <hostname> | --rollback"

# Record the current value so the log shows the transition (never a secret).
CURRENT="$(${SETTER} --status 2>/dev/null | sed -n 's/^current: //p' | head -1 || true)"
log "current canonical URL: ${CURRENT:-(unset)}"

# 1. stage (set-app-url.mjs re-validates the hostname and self-restores on write failure)
log "staging new canonical URL for host: ${HOST}"
${SETTER} --apply "$HOST" || die "failed to stage new canonical URL (nothing changed)"

# 2. controlled restart
if ! restart_app; then
  log "restart failed after staging; rolling back"
  rollback
  exit 1
fi

# 3. health gate
if wait_healthy; then
  log "canonical URL activation complete and healthy"
  exit 0
fi

# 4. self-heal
log "app did not become healthy after activation; rolling back"
rollback
exit 1
