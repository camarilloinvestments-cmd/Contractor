#!/usr/bin/env node
// record-update-history.mjs
// Persists a real UpdateHistory row from a secret-free JSON state file produced
// by scripts/os1-upgrade.sh. Runs INSIDE the app container (shares the Prisma
// client + DATABASE_URL) so the updater can record an auditable upgrade trail.
//
// Usage:  node scripts/record-update-history.mjs <state.json>
// - If state.id is present -> update that row (idempotent step transitions).
// - Otherwise create a new row and print its id (stdout, last line) so the
//   caller can pass it back on the next transition.
// Never prints or stores secret values; only enum/result summaries.
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

const ACTIONS = new Set(['CHECK', 'DOWNLOAD', 'INSTALL', 'ROLLBACK', 'UPLOAD', 'RETRY']);
const SOURCES = new Set(['GITHUB', 'MANUAL']);
const RESULTS = new Set(['PENDING', 'IN_PROGRESS', 'SUCCESS', 'FAILED', 'ROLLED_BACK']);

function die(msg) { process.stderr.write(`record-update-history: ${msg}\n`); process.exit(1); }

const statePath = process.argv[2];
if (!statePath) die('usage: record-update-history.mjs <state.json>');
if (!fs.existsSync(statePath)) die(`state file not found: ${statePath}`);

let s;
try { s = JSON.parse(fs.readFileSync(statePath, 'utf8')); }
catch (e) { die(`state file is not valid JSON: ${e?.message ?? e}`); }

const startedAt = s.startedAt ? new Date(s.startedAt) : new Date();
const finishedAt = s.finishedAt ? new Date(s.finishedAt) : null;
let durationMs = null;
if (finishedAt && !Number.isNaN(finishedAt.getTime()) && !Number.isNaN(startedAt.getTime())) {
  durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
}

const action = ACTIONS.has(s.action) ? s.action : 'INSTALL';
const source = SOURCES.has(s.source) ? s.source : 'GITHUB';
const result = RESULTS.has(s.result) ? s.result : 'IN_PROGRESS';

// Secret-free structured summary of facts that have no dedicated column
// (candidate image + digest, backup path, security posture, failure stage).
const logs = JSON.stringify({
  candidateImage: s.candidateImage || null,
  candidateDigest: s.candidateDigest || null,
  backupPath: s.backupPath || null,
  securityResult: s.securityResult || null,
  failStage: s.failStage || null,
});

const message = s.failReason
  ? `stage=${s.failStage || 'unknown'}: ${s.failReason}`
  : (result === 'SUCCESS' ? 'Upgrade completed successfully.' : null);

const data = {
  action,
  source,
  result,
  fromVersion: s.fromVersion || null,
  toVersion: s.toVersion || null,
  commit: s.commit || null,
  fromCommit: s.fromCommit || null,
  toCommit: s.toCommit || null,
  rollbackResult: s.rollbackResult || null,
  backupResult: s.backupResult || null,
  migrationsResult: s.migrationsResult || null,
  healthResult: s.healthResult || null,
  durationMs,
  message,
  logs,
  finishedAt,
};

const prisma = new PrismaClient();
try {
  let id = s.id && String(s.id).trim() ? String(s.id).trim() : null;
  if (id) {
    await prisma.updateHistory.update({ where: { id }, data });
  } else {
    const row = await prisma.updateHistory.create({
      data: { ...data, startedAt },
    });
    id = row.id;
  }
  process.stdout.write(id + '\n');
} catch (e) {
  die(`failed to persist UpdateHistory: ${e?.message ?? e}`);
} finally {
  await prisma.$disconnect().catch(() => {});
}
