#!/usr/bin/env node
// set-maintenance.mjs — toggle the application's AUTHORITATIVE maintenance gate.
//
// Usage:  node scripts/set-maintenance.mjs on
//         node scripts/set-maintenance.mjs off
//         node scripts/set-maintenance.mjs status
//
// Writes UpdateSettings.maintenanceMode using the container's Prisma client +
// DATABASE_URL, so the shell updater can enable/disable maintenance WITHOUT an
// interactive browser/API session. Run it from the app/candidate container so it
// shares the Prisma client, DATABASE_URL and the UpdateSettings schema.
//
// The running (old) appliance image may not contain this script and the app data
// dir is a NAMED docker volume (not a host bind mount), so the updater invokes
// this FROM the verified candidate image against the same database.
//
// Safety for upgrades from a pre-0018/0019 appliance: maintenanceMode has
// existed on UpdateSettings since migration 0010, but we still VERIFY the column
// is present before depending on it. If it is missing (schema too old) we exit
// non-zero so the updater STOPS BEFORE MIGRATIONS instead of silently
// continuing without a real gate.
//
// After a write we READ BACK and confirm the value actually changed, and print
// the resulting state ('on' | 'off') as the last stdout line so the caller can
// verify. Never prints secrets.
import { PrismaClient } from '@prisma/client';

const ID = 'default';
const mode = (process.argv[2] || '').toLowerCase();

function die(msg) {
  process.stderr.write(`set-maintenance: ${msg}\n`);
  process.exit(1);
}

if (!['on', 'off', 'status'].includes(mode)) {
  die('usage: set-maintenance.mjs on|off|status');
}

const prisma = new PrismaClient();
try {
  // Confirm the database is reachable first so a connectivity failure is not
  // misreported as a missing column.
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    die(`database not reachable: ${e?.message ?? e}`);
  }
  // Verify the maintenanceMode column exists before depending on it. On a schema
  // older than the update-center migration this raw SELECT throws -> STOP.
  try {
    await prisma.$queryRaw`SELECT "maintenanceMode" FROM "UpdateSettings" LIMIT 1`;
  } catch {
    die('UpdateSettings.maintenanceMode not present — refusing to proceed (appliance schema too old to gate safely)');
  }

  if (mode === 'status') {
    const s = await prisma.updateSettings.findUnique({
      where: { id: ID },
      select: { maintenanceMode: true },
    });
    process.stdout.write((s?.maintenanceMode ? 'on' : 'off') + '\n');
  } else {
    const enabled = mode === 'on';
    // Ensure the singleton row exists, then set the flag.
    await prisma.updateSettings.upsert({
      where: { id: ID },
      update: { maintenanceMode: enabled },
      create: { id: ID, maintenanceMode: enabled },
    });
    // Read back and confirm the change actually took effect.
    const s = await prisma.updateSettings.findUnique({
      where: { id: ID },
      select: { maintenanceMode: true },
    });
    if (!!s?.maintenanceMode !== enabled) {
      die(`verification failed: maintenanceMode is ${!!s?.maintenanceMode}, expected ${enabled}`);
    }
    process.stdout.write((enabled ? 'on' : 'off') + '\n');
  }
} catch (e) {
  die(`failed: ${e?.message ?? e}`);
} finally {
  await prisma.$disconnect().catch(() => {});
}
