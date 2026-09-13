// Database bootstrap for container start (Phase 1 / v1.1.0).
//
// Safely transitions any database to the Prisma migration system, then applies
// pending migrations. Three cases are handled:
//
//   1. Fresh / empty DB               -> `migrate deploy` creates everything.
//   2. Pre-existing v1.0.0 DB built by `prisma db push` (has app tables but no
//      `_prisma_migrations` history) -> baseline it by marking 0000_baseline as
//      already applied (`migrate resolve --applied`), THEN `migrate deploy`
//      applies 0001+ on top. The baseline is NEVER re-run against existing tables.
//   3. DB already on the migration system -> `migrate deploy` applies whatever is
//      pending (idempotent; a no-op when up to date).
//
// This script never drops data and never runs `migrate reset`.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const BASELINE = '0000_baseline';
// Call the Prisma CLI directly so we do not depend on which package manager
// (yarn classic vs berry, npm, pnpm) is available at container runtime.
const PRISMA = existsSync('node_modules/.bin/prisma') ? 'node_modules/.bin/prisma' : 'prisma';
const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

async function main() {
  const prisma = new PrismaClient();
  let hasMigrations = false;
  let hasApp = false;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS has_migrations,
              to_regclass('public."User"') IS NOT NULL AS has_app`
    );
    hasMigrations = !!rows?.[0]?.has_migrations;
    hasApp = !!rows?.[0]?.has_app;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }

  if (hasMigrations) {
    console.log('[bootstrap] Migration history present. Applying pending migrations...');
  } else if (hasApp) {
    console.log(
      '[bootstrap] Existing schema detected without migration history (pre-1.1.0 db push database).'
    );
    console.log(`[bootstrap] Baselining: marking ${BASELINE} as already applied (no tables recreated).`);
    run(`${PRISMA} migrate resolve --applied ${BASELINE}`);
  } else {
    console.log('[bootstrap] Empty database. Applying all migrations from scratch...');
  }

  run(`${PRISMA} migrate deploy`);
  console.log('[bootstrap] Database is up to date.');
}

main().catch((err) => {
  console.error('[bootstrap] FAILED:', err?.message ?? err);
  process.exit(1);
});
