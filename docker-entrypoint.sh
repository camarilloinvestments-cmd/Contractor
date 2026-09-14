#!/bin/sh
# ---------------------------------------------------------------------------
# Container entrypoint for OS1 Fiber Track Pro.
# Runs once per container start, before the app server boots:
#   1. Brings the database onto the Prisma migration system and applies pending
#      migrations (prisma migrate deploy), auto-baselining a pre-1.1.0 database
#      that was originally created with `prisma db push`.
#   2. Optionally seeds REFERENCE/config data only, no user accounts (idempotent).
#
# The migration system replaced the old `prisma db push` step in v1.1.0. See
# docs/MIGRATIONS.md for the operator runbook and rollback procedure.
# ---------------------------------------------------------------------------
set -e

echo "[entrypoint] Checking secret encryption configuration..."
node scripts/check-encryption.mjs || true

echo "[entrypoint] Bringing database up to date (prisma migrate deploy)..."
node scripts/db-bootstrap.mjs

if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] Seeding database (idempotent upserts)..."
  if yarn prisma db seed; then
    echo "[entrypoint] Seed complete."
  else
    echo "[entrypoint] Seed step reported an error; continuing to start the app."
  fi
fi

# ---------------------------------------------------------------------------
# Canonical URL consumption (§3). The operator can set the app's public URL from
# Settings -> Domain & SSL, which persists a single line to $APP_URL_CONFIG_PATH:
#     NEXTAUTH_URL=https://<host>
# We consume ONLY that key here, with strict validation, and export it so
# Next.js/NextAuth pick up the canonical URL. We deliberately do NOT `source`
# the file (that would execute arbitrary shell) and we ignore anything that is
# not an exact, well-formed NEXTAUTH_URL=https://<host> line. NEXTAUTH_SECRET /
# AUTH_SECRET are NEVER read from this file.
APP_URL_CONFIG_PATH="${APP_URL_CONFIG_PATH:-/app/data/app-url.env}"
if [ -f "$APP_URL_CONFIG_PATH" ]; then
  # Grab the first strictly-matching line only. Host must contain a dot and use
  # https. No spaces, no shell metacharacters are possible given this pattern.
  _canonical_line="$(grep -E '^NEXTAUTH_URL=https://[A-Za-z0-9.-]+$' "$APP_URL_CONFIG_PATH" | head -n 1 || true)"
  if [ -n "$_canonical_line" ]; then
    _canonical_url="${_canonical_line#NEXTAUTH_URL=}"
    _canonical_host="${_canonical_url#https://}"
    # Require a dotted host (reject bare labels like https://localhost with no dot).
    case "$_canonical_host" in
      *.*)
        export NEXTAUTH_URL="$_canonical_url"
        echo "[entrypoint] Applied canonical NEXTAUTH_URL from persisted config."
        ;;
      *)
        echo "[entrypoint] Ignoring malformed canonical URL host in persisted config."
        ;;
    esac
  fi
fi

echo "[entrypoint] Starting application..."
exec "$@"
