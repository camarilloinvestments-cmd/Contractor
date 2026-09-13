# Changelog

All notable changes to FiberTrack Pro are documented here.
This project uses [Semantic Versioning](https://semver.org/) (MAJOR.MINOR.PATCH).

---

## v1.0.0 — Known-Good Baseline (2026-09-13)

First production-banked release. This is the **known-good baseline**: the exact
commit confirmed to build and run via Docker on a self-hosted Ubuntu server.
All future development branches from this tag.

### Application
- Contractor billing & job-management platform (FiberTrack Pro).
- Role-based access: Admin, Project Manager, Field Worker (NextAuth, JWT).
- Admin console: prime contractors, jobs, tasks, workers, task types,
  invoices, payouts, reports, users.
- Field-worker portal (mobile-first) with GPS-verified task workflow.
- PDF invoice generation and S3-backed file uploads (presigned URLs).

### Self-hosting / Docker (fixes banked in this release)
- **Dockerfile**: dependencies now install with `--production=false` so
  build-only devDependencies (tailwindcss, tailwindcss-animate, postcss, etc.)
  are present during `yarn build` even under `NODE_ENV=production`.
- **yarn.lock**: committed (classic Yarn v1) for reproducible,
  `--frozen-lockfile` installs from a clean clone.
- **.dockerignore**: no longer excludes `yarn.lock`, so the lockfile is present
  in the Docker build context required by `COPY package.json yarn.lock ./`.
- **.yarnrc.yml**: reduced to portable `nodeLinker: node-modules`.

### Security
- No secrets, `.env` files, passwords, tokens, or private keys committed.
- `.env` is gitignored; only `.env.docker.example` (placeholders) is tracked.

### Verified
- `yarn install --production=false` succeeds; all build packages resolve.
- `yarn prisma generate` succeeds.
- `yarn build` completes successfully (all routes compiled).
- Real Docker build confirmed working on the production Ubuntu server.
