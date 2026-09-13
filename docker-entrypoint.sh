#!/bin/sh
# ---------------------------------------------------------------------------
# Container entrypoint for FiberTrack Pro.
# Runs once per container start, before the app server boots:
#   1. Applies the Prisma schema to the database (creates/updates tables).
#   2. Optionally seeds demo data (idempotent - safe to repeat).
# ---------------------------------------------------------------------------
set -e

echo "[entrypoint] Applying database schema (prisma db push)..."
yarn prisma db push --skip-generate

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
