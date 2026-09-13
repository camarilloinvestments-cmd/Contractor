#!/bin/sh
# ---------------------------------------------------------------------------
# Container entrypoint for OS1 Fiber Track Pro.
# Runs once per container start, before the app server boots:
#   1. Brings the database onto the Prisma migration system and applies pending
#      migrations (prisma migrate deploy), auto-baselining a pre-1.1.0 database
#      that was originally created with `prisma db push`.
#   2. Optionally seeds demo/default data (idempotent - safe to repeat).
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

echo "[entrypoint] Starting application..."
exec "$@"
