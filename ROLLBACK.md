# Rollback Reference

This document is the authoritative rollback procedure for FiberTrack Pro
self-hosted (Docker) deployments.

---

## Known-good baseline

| Item            | Value                                          |
|-----------------|------------------------------------------------|
| Version tag     | `v1.0.0`                                        |
| Branch          | `main`                                          |
| Repository      | `camarilloinvestments-cmd/Contractor` (private) |

> The exact baseline commit hash for `v1.0.0` is recorded in the GitHub
> Release for `v1.0.0` and in `git show v1.0.0`. Always roll back to the
> **tag**, not to a branch tip, so you land on the proven build.

---

## Roll back to v1.0.0

From your deployment directory on the server:

```bash
# 1) Fetch tags and check out the known-good baseline
git fetch --all --tags
git checkout v1.0.0

# 2) Rebuild the image from the baseline
docker compose build --no-cache

# 3) Restart the stack
docker compose down
docker compose up -d

# 4) Confirm health
docker compose ps
docker compose logs -f app     # Ctrl-C once you see it listening on :3000
```

The app should respond on the configured `APP_PORT` (default 3000).

---

## Database safety before any rollback

Always back up PostgreSQL **before** rolling back if the newer version applied
migrations. A newer schema may not be readable by older code.

```bash
# Back up (adjust service/db names to your docker-compose.yml)
docker compose exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  > backup_$(date +%Y%m%d_%H%M%S).sql
```

If a rollback requires restoring the database:

```bash
cat backup_YYYYMMDD_HHMMSS.sql | \
  docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

> v1.0.0 is the initial schema baseline. Future releases will document their
> own migration and down-migration steps in `CHANGELOG.md` and their GitHub
> Release notes.

---

## Return to latest after a rollback

```bash
git checkout main
git pull
docker compose build --no-cache
docker compose up -d
```
