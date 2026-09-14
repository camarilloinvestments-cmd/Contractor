// Canonical, ordered install pipeline surfaced to the operator UI. The in-app
// control plane verifies + stages a package and records history; the host
// installer (scripts/os1-upgrade.sh / scripts/install-update.sh) actually runs
// these steps. Keeping the ordered list in one place means the UI shows exactly
// the stages the host script performs, in the same order, so an operator always
// sees what an update will do before pressing Install.

export type PipelineStepKey =
  | 'preflight'
  | 'db_backup'
  | 'env_backup'
  | 'package_verify'
  | 'candidate_build'
  | 'migrations'
  | 'cutover'
  | 'health'
  | 'security'
  | 'complete';

export interface PipelineStep {
  key: PipelineStepKey;
  label: string;
  detail: string;
}

// The exact stages the one-button install runs, in order (ruling #25).
export const INSTALL_PIPELINE: PipelineStep[] = [
  { key: 'preflight', label: 'Preflight', detail: 'Validate toolchain, versions, disk, memory, env, migrations and release ref.' },
  { key: 'db_backup', label: 'DB Backup', detail: 'pg_dump the live database to an on-host backup before any change.' },
  { key: 'env_backup', label: 'Env Backup', detail: 'Snapshot the current .env, running version + SHA, migration state and image ref (no secret values shown).' },
  { key: 'package_verify', label: 'Package Verify', detail: 'Re-check SHA-256 and the pinned release signature; refuse any unverified or unsafe package.' },
  { key: 'candidate_build', label: 'Candidate Build', detail: 'Build contractor-app:candidate-<sha> without touching the running image tag.' },
  { key: 'migrations', label: 'Migrations', detail: 'Apply pending Prisma migrations (prisma migrate deploy) against the candidate.' },
  { key: 'cutover', label: 'Cutover', detail: 'Switch traffic to the verified candidate image.' },
  { key: 'health', label: 'Health', detail: 'HTTP + database health checks on the new release.' },
  { key: 'security', label: 'Security', detail: 'Confirm non-root runtime (uid 10001) and signature enforcement post-cutover.' },
  { key: 'complete', label: 'Complete', detail: 'Clear maintenance mode and record the successful update.' },
];

// The point after which a failure can no longer be undone by an app-only
// rollback and a DATABASE RESTORE is required (a controlled, operator-gated
// action). Everything at/after 'migrations' may have mutated the schema/data.
export const DB_MUTATING_FROM: PipelineStepKey = 'migrations';
