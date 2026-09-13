# Changelog

All notable changes to FiberTrack Pro are documented here.
This project uses [Semantic Versioning](https://semver.org/) (MAJOR.MINOR.PATCH).

---

## v1.1.0 — Migration Foundation, Branding & Email (2026-09-13)

Additive foundation release. Builds on the immutable v1.0.0 baseline. The
database schema is now managed by **Prisma Migrations** instead of
`prisma db push`, and the release adds a single-company branding/white-label
foundation, an SMTP email foundation with encrypted credentials, safe email
templates, branded invoice PDFs, and invoice email sending plus audit/email
logging. **No existing table or column was dropped or altered destructively.**

### Database & migrations
- Introduced formal Prisma migration baseline `0000_baseline` capturing the exact
  v1.0.0 schema, plus additive migration `0001_phase1_foundation`.
- Container start now runs `scripts/db-bootstrap.mjs` → `prisma migrate deploy`
  (replacing `prisma db push`). A pre-1.1.0 `db push` database is **auto-baselined**
  (`migrate resolve --applied 0000_baseline`) so existing data is preserved and the
  baseline is never re-run against existing tables. See `docs/MIGRATIONS.md`.
- New schema objects (all additive): `EmailStatus` enum; `Invoice.lastEmailedAt`
  and `Invoice.emailCount` columns; and tables `CompanyProfile`, `EmailSettings`,
  `EmailTemplate`, `EmailLog`, `AuditLog`.

### Branding / white-label (single company)
- `CompanyProfile` singleton: company name, address, website, support email/phone,
  logo URL, and brand colors, editable in **Settings → Branding** (Admin only).
- Branding flows through the app shell, auth pages, and invoice PDFs, with a safe
  fallback when no profile is configured. (Multi-tenant branding is deferred.)

### Email foundation
- SMTP settings configured in **Settings → Email** (Admin only). The SMTP password
  is stored **encrypted (AES-256-GCM)** using a new required `APP_ENCRYPTION_KEY`.
  The system is **fail-closed**: without the key the email feature is disabled and
  no plaintext password is ever stored or read.
- Safe email templates rendered from a fixed **allow-list of 25 variables** only —
  `{{variable}}` substitution with **no code execution** (no eval/expressions).
- Branded invoice PDF plus **send / resend invoice by email**, with automatic
  new-vs-reminder template selection and DRAFT→SENT transition.
- **Email delivery logging** (`EmailLog`) and a general **audit foundation**
  (`AuditLog`) viewable in Settings.

### New environment variables
- `APP_ENCRYPTION_KEY` (**required** for the email feature) — see
  `.env.docker.example` and `docs/MIGRATIONS.md` for generation, backup, recovery,
  and rotation. Generated outside source control; never committed.

### Dependencies
- Added `nodemailer` (+ `@types/nodemailer`). `yarn.lock` remains classic Yarn v1.

### Verified
- `tsc --noEmit` clean; `next build` completes with all new routes compiled.
- Migrations validated on PostgreSQL 17: fresh install, upgrade from a simulated
  v1.0.0 `db push` database (data preserved), and idempotent re-run — all with
  **zero schema drift** (`migrate diff --exit-code` == 0) and a fresh-install vs
  upgraded-database schema comparison showing no difference.
- Encryption round-trip, fail-closed behaviour, and template allow-list
  enforcement covered by functional tests.

### Upgrade & rollback
- Upgrade procedure: `docs/MIGRATIONS.md`. Rollback: `ROLLBACK.md` (code-only
  rollback is safe because `0001` is purely additive).

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
