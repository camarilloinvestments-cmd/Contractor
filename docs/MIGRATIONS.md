# Database Migrations & Upgrade Runbook

**Applies to:** FiberTrack Pro v1.1.0 and later
**Audience:** operators self-hosting via Docker

Starting with **v1.1.0**, FiberTrack Pro manages its database schema with **Prisma
Migrations** (`prisma migrate deploy`). The old v1.0.0 behaviour (`prisma db push`
on every container start) has been removed. This document is the authoritative
procedure for upgrading, verifying, and rolling back the schema.

---

## 1. How schema changes are applied

On every container start, the entrypoint runs `node scripts/db-bootstrap.mjs`
**before** the app server boots. The bootstrap script is idempotent and never
drops data or runs `migrate reset`. It handles three situations automatically:

| Situation | What the bootstrap does |
|-----------|-------------------------|
| **Empty database** (brand-new install) | Runs `prisma migrate deploy`, which creates all tables from `0000_baseline` then `0001_phase1_foundation`. |
| **Existing v1.0.0 database** built by `prisma db push` (has app tables but **no** `_prisma_migrations` history) | Marks `0000_baseline` as *already applied* (`prisma migrate resolve --applied 0000_baseline`) so the baseline is **never re-run against your existing tables**, then runs `prisma migrate deploy` to apply `0001` and later migrations on top. Your data is preserved. |
| **Database already on the migration system** | Runs `prisma migrate deploy`, which applies any pending migrations, or is a no-op when already up to date. |

The migrations that ship in this release live in `prisma/migrations/`:

- `0000_baseline/migration.sql` — the exact v1.0.0 schema (15 tables, 7 enums,
  indexes, and foreign keys). This is a **baseline**: it represents what a
  v1.0.0 `db push` database already contains, so it is only ever *executed* on a
  brand-new empty database, and merely *marked applied* when upgrading an
  existing v1.0.0 database.
- `0001_phase1_foundation/migration.sql` — the additive v1.1.0 changes
  (email/branding/audit foundation). Purely additive: one new enum, two new
  nullable/defaulted columns on `Invoice`, and five new tables. It does not drop
  or alter any existing column, so it is safe on a populated database.

---

## 2. Upgrading a production server from v1.0.0 to v1.1.0

> Do this on a **staging copy first** if at all possible (see section 3).

```bash
# 0) Go to your deployment directory (where docker-compose.yml lives)
cd /path/to/fibertrack

# 1) ALWAYS back up the database first (see section 5)
docker compose exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  > backup_pre_v1.1.0_$(date +%Y%m%d_%H%M%S).sql

# 2) Add the new required secret for the email feature (generate once, keep safe)
#    Edit your .env and set APP_ENCRYPTION_KEY (see section 6).
openssl rand -base64 32   # copy the output into APP_ENCRYPTION_KEY in .env

# 3) Fetch the new release and check out the tag
git fetch --all --tags
git checkout v1.1.0

# 4) Rebuild and restart
docker compose build --no-cache
docker compose down
docker compose up -d

# 5) Watch the entrypoint apply migrations
docker compose logs -f app
#   You should see:
#     [entrypoint] Bringing database up to date (prisma migrate deploy)...
#     [bootstrap] Existing schema detected without migration history ...
#     [bootstrap] Baselining: marking 0000_baseline as already applied ...
#     Applying migration `0001_phase1_foundation`
#     [bootstrap] Database is up to date.
#     [entrypoint] Starting application...
```

The app is healthy when `GET /api/health` returns HTTP 200 and the login page loads.

---

## 3. Verify the upgrade

### Migration history and status
```bash
# Should list 0000_baseline and 0001_phase1_foundation as applied, no pending.
docker compose exec app node_modules/.bin/prisma migrate status
# Expected: "Database schema is up to date!"
```

### Schema-drift check (schema.prisma vs the live database)
```bash
docker compose exec app node_modules/.bin/prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
# Exit code 0 and "No difference detected." == zero drift.
```

### Data preserved
Log in with an existing account and confirm your contractors, jobs, and invoices
are all present. The upgrade is purely additive and does not touch existing rows.

---

## 4. Rolling back

Rollback is covered in full in [`../ROLLBACK.md`](../ROLLBACK.md). Summary:

Because `0001_phase1_foundation` is **purely additive**, v1.0.0 application code
runs fine against the v1.1.0 schema (the extra tables/columns are simply
ignored). Therefore the **fast, safe rollback is code-only** — no database
changes required:

```bash
git checkout v1.0.0
docker compose build --no-cache
docker compose down && docker compose up -d
```

If you also want to remove the v1.1.0 schema objects (not required), restore the
pre-upgrade backup you took in section 2 step 1:

```bash
cat backup_pre_v1.1.0_YYYYMMDD_HHMMSS.sql | \
  docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

> Prefer the code-only rollback. Restoring a backup loses any data written after
> the upgrade. Only restore if you specifically need the schema reverted.

The additive migration can also be reversed manually if ever required (drops the
five new tables, the two new `Invoice` columns, and the `EmailStatus` enum). This
is destructive to email/branding/audit data only and should be scripted and
tested on staging before use.

---

## 5. Database backups

Always back up **before** any upgrade or rollback.

```bash
# Back up
docker compose exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore
cat backup_YYYYMMDD_HHMMSS.sql | \
  docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

---

## 6. APP_ENCRYPTION_KEY — backup, recovery, and rotation

The email feature stores the SMTP password as **AES-256-GCM ciphertext**. The key
is read from the `APP_ENCRYPTION_KEY` environment variable. The system is
**fail-closed**: if the key is not set, the app refuses to encrypt or decrypt SMTP
credentials (the email feature is simply unavailable) — it never falls back to
storing or reading a plaintext password.

**Generate (once):**
```bash
openssl rand -base64 32
```
Put the value in `.env` as `APP_ENCRYPTION_KEY=...`. **Never commit it** to git.

**Back it up:** store the key in your password manager or secrets vault, separate
from the database backups. The encrypted SMTP password in the database is
**unrecoverable without this key**.

**If you lose the key:** existing SMTP ciphertext can no longer be decrypted.
Recovery is simple — set a new `APP_ENCRYPTION_KEY`, restart, then re-enter the
SMTP password in **Settings → Email**. No other data is affected (only the SMTP
password is encrypted with this key).

**Rotation:** to rotate the key, set the new `APP_ENCRYPTION_KEY`, restart the
app, and re-enter the SMTP password once in **Settings → Email** (this re-encrypts
it with the new key). All other settings are unaffected.

---

## 7. Manual baselining (advanced / disaster recovery)

The bootstrap script handles baselining automatically. If you ever need to do it
by hand against a v1.0.0 `db push` database:

```bash
# Mark the baseline as applied WITHOUT recreating existing tables
docker compose exec app node_modules/.bin/prisma migrate resolve --applied 0000_baseline
# Then apply everything newer
docker compose exec app node_modules/.bin/prisma migrate deploy
```

Never run `prisma migrate reset` or `prisma db push --accept-data-loss` against a
production database — both are destructive.