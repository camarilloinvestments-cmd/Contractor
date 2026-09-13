# Self-Hosting FiberTrack Pro with Docker

This guide runs the entire application (web app + PostgreSQL database) on your own
Ubuntu server using Docker and Docker Compose.

## Prerequisites

- A server (Ubuntu 22.04+ recommended) with **Docker Engine** and the **Docker Compose plugin** installed:
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```
- The project files (this `nextjs_space` folder) copied onto the server.

## 1. Configure

From inside this folder (the one containing `docker-compose.yml`):

```bash
cp .env.docker.example .env
```

Edit `.env` and set at minimum:

- `POSTGRES_PASSWORD` – a strong database password.
- `NEXTAUTH_SECRET` – generate one with `openssl rand -base64 32`.
- `NEXTAUTH_URL` – the public URL the app will be reached at (e.g. `https://fibertrack.yourdomain.com`, or `http://localhost:3000` for a local test).
- **File uploads:** set the `AWS_*` values to your own S3-compatible bucket and an access key that can read/write it. Photo & document uploads stay disabled until these are filled in. Everything else (jobs, billing, GPS records, invoices, reports) works without them.

## 2. Build & start

```bash
docker compose up -d --build
```

This will:
1. Start a PostgreSQL 16 container with a persistent volume (`db_data`).
2. Build the app image and start it.
3. On first boot, create the database tables and seed demo data.

## 3. Open the app

Visit `http://<your-server>:3000` (or the port you set in `APP_PORT`).

Default seeded logins:

| Role            | Email                          | Password    |
|-----------------|--------------------------------|-------------|
| Admin           | admin@fibertrack.com           | Admin123!   |
| Project Manager | pm@fibertrack.com              | Manager123! |
| Field Worker    | carlos@ramirezsplicing.com     | Worker123!  |

> Change these passwords after first login.

## Everyday commands

```bash
docker compose logs -f app      # tail application logs
docker compose ps               # container status
docker compose down             # stop (keeps the database volume)
docker compose up -d --build    # rebuild & restart after code changes
```

## Database schema & seeding

- The schema is applied automatically on every start via `prisma db push`.
- Seeding runs on start only when `SEED_ON_START=true` (the default). The seed uses
  idempotent upserts, so it will not duplicate data. Once you have real data you can
  set `SEED_ON_START=false` in `.env` and restart.
- To seed manually at any time:
  ```bash
  docker compose exec app yarn prisma db seed
  ```

## Backups

The database lives in the `db_data` Docker volume. Back it up with:

```bash
docker compose exec db pg_dump -U fibertrack fibertrack > fibertrack-backup.sql
```

Restore with:

```bash
cat fibertrack-backup.sql | docker compose exec -T db psql -U fibertrack fibertrack
```

## Running behind HTTPS

For production, put a reverse proxy (Nginx, Caddy, or Traefik) in front of the app
container to terminate TLS, and set `NEXTAUTH_URL` to your `https://` domain.
A minimal Caddy example:

```
fibertrack.yourdomain.com {
    reverse_proxy localhost:3000
}
```

## Notes

- The app listens on port **3000** inside the container; map it to any host port via `APP_PORT`.
- Do not commit your real `.env` to version control — it holds secrets. Only `.env.docker.example` is safe to share.
- File uploads use S3-compatible presigned URLs. If you use a non-AWS provider (MinIO, Cloudflare R2, etc.), ensure the bucket has a CORS policy allowing `PUT`/`GET` from your app's origin.
