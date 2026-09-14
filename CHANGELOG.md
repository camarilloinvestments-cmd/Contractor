# Changelog

All notable changes to FiberTrack Pro are documented here.
This project uses [Semantic Versioning](https://semver.org/) (MAJOR.MINOR.PATCH).

---

## v1.2.0-rc.1 — In Development (Release Candidate)

Additive feature release building on the immutable v1.0.0 and v1.1.0 baselines.
**No existing table or column has been dropped or altered destructively.** All new
schema objects are additive and verified against the upgrade path (legacy rows
preserved, new tables created empty, zero schema drift).

> This section is a running record accumulated across development increments and
> will be finalized when v1.2.0-rc.1 is tagged as a GitHub pre-release.

### Workstreams A–F (foundation, delivered in earlier increments)
- **A/B/C** — Product/version identity, environment & configuration hardening,
  and role/permission groundwork.
- **D/X** — Data-integrity and audit-trail extensions.
- **E** — Multi-factor authentication (MFA) enrollment and enforcement policy.
- **F** — Branding logo/image uploads via S3 presigned URLs (private, signed
  access), reusable for KMZ/PDF branding.

### Workstreams G/H/I/J — Prime price books, Excel import, AI-assist & rate books
- **G — Prime Contractor Price Books.** New versioned price-book layer keyed on
  string job codes (distinct from the existing `TaskType` catalog). A price book
  has a lifecycle (`DRAFT → ACTIVE → ARCHIVED`); activating a book automatically
  archives the prior active book of the same name. Books can be cloned to a new
  draft version. Managed per prime at **Prime Contractors → Price Books**
  (Admin & Project Manager).
- **H — Excel/CSV import.** Upload a price list (`.xlsx`/`.csv`), auto-detect
  column mapping, preview a full diff against the target book (new / unchanged /
  increases / decreases / duplicates / rows needing fixes), download an error
  workbook for rows that need attention, and approve to replace the draft's lines
  in a single transaction. Downloadable import template and client-safe export.
- **I — AI-assisted column mapping.** Optional AI suggestion of column mapping
  (OpenAI-compatible endpoint, suggestion-only, temperature 0). Fails soft:
  falls back to heuristic auto-detection and never blocks the import.
- **J — Rate Books (internal cost).** New versioned **Subcontractor Rate** and
  **In-House Rate** books keyed on job code. Saving a rate creates a new version
  (never overwrites); jobs retain the rate active when work was recorded. Managed
  at **Rate Books** (Admin & Project Manager). These are internal cost rates and
  are never exposed on client-facing (prime) exports — enforced by `canManage`
  gating on both read and write.

#### Database & migrations (G/H/I/J)
- Additive migration `0006_price_books`. New enums `PriceBookStatus`,
  `PriceImportStatus`, `RateStatus`; new tables `PriceBook`, `PriceLine`
  (`@@unique([priceBookId, jobCode])`), `PriceImport`, `SubcontractorRate`,
  `InHouseRate`; new relations on `PrimeContractor` and `Worker`. All monetary
  values stored as integer cents.

#### Dependencies (G/H/I/J)
- Added `exceljs` for spreadsheet template/import/export generation.

### Workstreams K–L (this increment)

- **K — Sales & Compensation Plans (internal cost).** New **Sales** admin area
  (Admin & Project Manager) with **Salespeople** and **Compensation Plans** tabs.
  Six configurable plan types — percent of revenue, percent of gross profit, flat
  per job, flat per task, production rate (per unit), and tiered by revenue — each
  with a configurable **earned event** (Job Completed, Job Approved, Invoice
  Generated, Invoice Paid; default Invoice Paid) and optional prime/task overrides.
  Commission math lives in a pure, deterministic `lib/commission.ts` (integer cents).
  **Historical retention:** every recorded commission snapshots the exact plan
  name, type, earned event and full rate config at calculation time, so editing or
  archiving a plan never rewrites past commissions.
- **L — Job Financial Summary.** New **Financials** tab on the job detail page
  showing Prime Revenue − Subcontractor Production Cost − In-House Production Cost
  − Sales Commission − Other Direct Costs = **Gross Contribution**, plus **Gross
  Margin %**, with a per-task cost breakdown drill-down. Salesperson/plan
  assignment and an Other Direct Costs editor live on the same tab, with a
  Calculate & Record Commission action. All figures are internal and are never
  shown on client-facing (prime) exports (`canManage` gating on every route).

#### Database & migrations (K/L)
- Additive migration `0007_sales_commission`. Adds `SALES` to `UserRole`; new
  enums `SalespersonStatus`, `CommissionPlanType`, `CommissionEarnedEvent`,
  `CommissionPlanStatus`, `CommissionRecordStatus`; new tables `Salesperson`,
  `CommissionPlan`, `CommissionRecord`; new `Job` columns `otherDirectCosts`,
  `salespersonId`, `commissionPlanId` (all nullable/defaulted — no destructive
  change). All monetary values stored as integer cents.

### Workstreams M & W (this increment)

- **M — Payment Processing (IPPay connector, sandbox-only).** New **Payments**
  settings tab (Admin) to configure the IPPay gateway: merchant/terminal IDs,
  write-only API username/password (encrypted at rest via `lib/crypto`, never
  returned to the browser, never logged), and toggles for card, ACH, and
  tokenization. A **Test Connection** action records last connection status,
  and a **Pay Now** action on invoices (`/api/invoices/[id]/pay`) charges through
  the gateway and posts payments against the invoice (`amountPaid`, status
  transitions). All financial writes are **idempotent** (idempotency key + unique
  constraint) and store the provider transaction/reference IDs and request IDs.
  The IPPay **production endpoint is hard-disabled in code** — only the sandbox
  gateway (`https://testgtwy.ippay.com/ippay`) is reachable in this release.
- **W — Versioned Public API foundation.** New `/api/v1` surface with API-key
  authentication (keys shown once at creation, stored only as SHA-256 hashes,
  scoped, expirable, revocable, with last-used IP/time tracking), per-key rate
  limiting, request IDs on every response, and idempotent financial writes via the
  `Idempotency-Key` header. Read endpoints for jobs, invoices, and payments;
  a write endpoint for payments; and a machine-readable **OpenAPI 3.0.3** document
  at `/api/v1/openapi.json`. Keys are managed from a new **API** settings tab.

#### Database & migrations (M/W)
- Additive migration `0008_payments_api`. New enums `PaymentEnvironment`,
  `PaymentProviderType`, `PaymentStatus`, `PaymentMethodType`, `ApiKeyStatus`;
  new tables `PaymentSettings`, `Payment`, `PaymentMethod`, `ApiKey`,
  `ApiIdempotencyKey`; new `Invoice.amountPaid` column (defaulted). All additive —
  no destructive change. Monetary values stored as integer cents.

### Workstreams N & O — Live Operations Map + Geotab fleet telematics (this increment)

- **N — Live Operations Map.** New **Operations → Live Map** (Admin & Project
  Manager) rendering job sites, field workers, subcontractors, crews, and fleet
  trucks as distinct layers on an interactive map (Leaflet + OpenStreetMap tiles).
  Each layer can be toggled independently; the view auto-refreshes on a short poll
  so positions stay current without reloading. Truck pins open a popup with live
  detail (driver, speed/motion, last-update age, assigned crew/worker/job) and
  quick actions: **View Vehicle**, **Current Job**, **History**, and
  **Today's Route**. Job sites show their geofence radius. All map data is served
  from `/api/live-map`, which is **role-scoped**: Admin/PM see the full operation,
  field workers see only their own position, and everyone else sees nothing.
- **O — GPS, geofencing & fleet telematics (Geotab).** A provider-abstracted
  telematics layer (future providers can be added behind the same interface) with
  an official **MyGeotab API** connector configured at **Settings → Integrations
  → Geotab**. Credentials are **server-side only, encrypted at rest via
  `lib/crypto`, never returned to the browser and never logged**; no scraping is
  used. A **feed/checkpoint sync** (`/api/fleet/sync`) resumes from a persisted
  cursor — it does **not** require a browser to be open — and de-duplicates on
  resume via a unique `(vehicleId, providerRef)` constraint so historical
  telemetry is never double-stored. A built-in **MOCK sandbox** (database `MOCK`)
  lets the full feature work end-to-end without live Geotab credentials.
  - **Normalized fleet model** with current vehicle state (position, speed,
    motion, driver, communicating flag) plus **stale/offline detection** (a
    last-known position is shown and flagged stale past a threshold when a device
    stops reporting).
  - **Mobile-worker GPS is kept in a separate stream** (`WorkerLocation`) from
    truck GPS (`VehicleTelemetry`) — the two are never conflated.
  - **Distinct geofence event types**: `WORKER_ARRIVED` / `WORKER_LEFT` and
    `VEHICLE_ARRIVED` / `VEHICLE_LEFT` are recorded as separate event types with a
    separate actor type, so worker and vehicle arrivals are never merged.
  - **Logistics history** at **Operations → Vehicle History**: pick a vehicle and
    date range (optionally a job) to see the route line, timeline, and a playback
    scrubber over stored telemetry. History reads report **"Source: Geotab"**.
  - **Role-based privacy:** internal fleet history, subcontractor assignments, and
    telematics are never exposed to customer/prime portal views or client-facing
    exports.

#### Database & migrations (N/O)
- Additive migration `0009_fleet_telematics`. New enums `LocationSource`,
  `FleetProviderType`, `VehicleMotion`, `GeoEventType`, `GeoActorType`; new tables
  `Crew`, `FleetProviderSettings` (singleton), `FleetFeedState`
  (`@@unique([provider, dataType])` sync checkpoint), `FleetVehicle`
  (`@@unique([provider, geotabDeviceId])`), `VehicleState` (1-to-1 current state),
  `VehicleTelemetry` (`@@unique([vehicleId, providerRef])` dedup), `VehicleTrip`,
  `WorkerLocation`, and `GeoEvent`; new additive relations/columns on `Worker`
  (crew membership, locations, geo events) and `Job` (`geofenceRadiusFeet`,
  current vehicles, telemetry, worker locations, geo events). All additive — no
  destructive change; zero schema drift verified.
- **Role note:** the existing role set (`ADMIN`, `PROJECT_MANAGER`,
  `FIELD_WORKER`, `SALES`) is used as-is. Fleet operations are limited to Admin &
  Project Manager; field workers post their own GPS and see only their own
  position; no new roles were introduced.

#### Dependencies (N/O)
- Added `leaflet` / `react-leaflet` (+ `@types/leaflet`) for the interactive map;
  map components are loaded client-side only (no SSR) with OpenStreetMap tiles.

---
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
