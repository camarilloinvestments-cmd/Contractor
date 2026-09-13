# FiberTrack Pro — Contractor Billing & Job Management System

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma&logoColor=white)
![NextAuth.js](https://img.shields.io/badge/NextAuth.js-Auth-purple)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?logo=tailwind-css&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)

FiberTrack Pro is a full-stack web application for fiber-optic / telecom contractors to
manage jobs, dispatch field crews, track work in the field with GPS, and handle the entire
billing chain — from Prime Contractor invoicing down to subcontractor payouts.

---

## Overview

The system connects three groups of users through role-based access control:

- **Admins & Project Managers** run the back office: they onboard Prime Contractors,
  create and assign jobs, define billable task types, review submitted work, generate
  invoices, and pay out subcontractors.
- **Field Workers** use a mobile-friendly portal to see assigned jobs, capture GPS
  location, upload progress photos & documents, and submit completed tasks for review.
- **Owners/Accountants** track revenue, outstanding invoices, and payouts through
  dashboards and reports.

The billing model flows in two directions: **Prime Contractor invoices** capture what the
company bills its clients, while **subcontractor payouts** track what the company owes the
crews who performed the work — giving a clear margin view per job.

---

## Key Features

- 🏢 **Prime Contractor management** — clients, rates, and billing details
- 📋 **Job & task management** — create jobs, break them into billable task types, and assign to workers
- 👷 **Field worker portal** — mobile-friendly interface for assigned jobs and task submission
- 📍 **GPS tracking** — capture and visualize job/worker locations on interactive maps
- 📸 **Photo & document uploads** — field evidence stored securely in S3-compatible storage
- 🧾 **Invoice generation** — professional PDF invoices for Prime Contractors
- 💵 **Subcontractor payouts** — track and settle amounts owed to crews
- 📊 **Dashboards & reports** — revenue, job status, and payout analytics with charts
- 🔐 **Role-based access control** — Admin, Project Manager, and Worker roles
- 🌗 **Light / dark mode** and responsive UI

---

## Tech Stack

| Layer          | Technology                                   |
| -------------- | -------------------------------------------- |
| Framework      | Next.js 16 (App Router)                       |
| Language       | TypeScript                                    |
| Database       | PostgreSQL 16                                  |
| ORM            | Prisma                                         |
| Auth           | NextAuth.js (JWT, credentials provider)        |
| Styling        | Tailwind CSS + shadcn/ui                        |
| Maps           | Leaflet.js / react-leaflet                      |
| Invoices (PDF) | @react-pdf/renderer                            |
| Charts         | Recharts                                        |
| File storage   | AWS S3 (S3-compatible)                          |
| Deployment     | Docker + Docker Compose                         |

---

## Quick Start (Docker)

The fastest way to run the full stack (web app + PostgreSQL) is with Docker Compose:

```bash
# 1. Create your environment file from the template
cp .env.docker.example .env    # then edit the values (see below)

# 2. Build and start the app + database
docker compose up -d --build

# 3. Open the app
#    http://localhost:3000
```

On first start the database schema is applied and (if `SEED_ON_START=true`) demo data is
seeded automatically. For a full self-hosting walkthrough — server setup, HTTPS, backups,
and troubleshooting — see **[DOCKER_README.md](./DOCKER_README.md)**.

---

## Environment Variables

Copy `.env.docker.example` to `.env` and fill in the values. **Never commit your real
`.env`** — it is gitignored. The template documents every variable; the key ones are:

| Variable              | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| `POSTGRES_USER`       | PostgreSQL username for the bundled database service                       |
| `POSTGRES_PASSWORD`   | Strong password for the database                                           |
| `POSTGRES_DB`         | Database name                                                              |
| `NEXTAUTH_SECRET`     | Auth signing secret — generate with `openssl rand -base64 32` (required)   |
| `AUTH_SECRET`         | Usually the same as `NEXTAUTH_SECRET`; leave blank to reuse it             |
| `NEXTAUTH_URL`        | Public URL the app is served from (e.g. `http://localhost:3000`)          |
| `APP_PORT`            | Host port to expose the app on (default `3000`)                            |
| `SEED_ON_START`       | Seed demo data on first start (`true`/`false`)                             |
| `AWS_REGION`          | AWS region of your S3 bucket                                               |
| `AWS_ACCESS_KEY_ID`   | Access key for S3 (uploads stay disabled until set)                        |
| `AWS_SECRET_ACCESS_KEY` | Secret key for S3                                                        |
| `AWS_BUCKET_NAME`     | S3 bucket for photos & documents                                          |
| `AWS_FOLDER_PREFIX`   | Optional key prefix inside the bucket (include trailing slash)             |
| `APP_ENCRYPTION_KEY`  | Encrypts the SMTP password for the email feature — `openssl rand -base64 32` (required for email) |

> File uploads (photos & documents) require the `AWS_*` values. Everything else — jobs,
> billing, GPS records, invoices, and reports — works without them.
>
> The email feature (invoice sending, branding-aware templates) requires
> `APP_ENCRYPTION_KEY`; SMTP host/user/password are configured in-app at
> **Settings → Email**. Keep this key backed up — see `docs/MIGRATIONS.md`.

> **Upgrading from v1.0.0?** The schema is now managed by database migrations that
> apply automatically on container start, auto-baselining an existing v1.0.0
> database without data loss. Follow `docs/MIGRATIONS.md`.

---

## Database Setup

When running without Docker (local development), apply the schema and seed data manually:

```bash
# Install dependencies
yarn install            # or: npm install

# Apply the Prisma schema to your database
npx prisma db push

# Generate the Prisma client
npx prisma generate

# Seed demo data (Prime Contractors, jobs, workers, task types, etc.)
npx prisma db seed
```

Make sure a `DATABASE_URL` pointing at your PostgreSQL instance is set in your `.env`
before running these commands.

---

## Default Login Accounts (seed data)

After seeding, you can sign in with these demo accounts:

| Role            | Email                    | Password      |
| --------------- | ------------------------ | ------------- |
| Admin           | `admin@fibertrack.com`   | `Admin123!`   |
| Project Manager | `pm@fibertrack.com`      | `Manager123!` |
| Field Worker    | `jake@fibertrack.com`    | `Worker123!`  |

> **Change these credentials immediately** in any non-demo / production deployment.

---

## Local Development

```bash
yarn install
yarn dev          # starts the Next.js dev server on http://localhost:3000
```

---

## Project Structure

```
.
├── app/            # Next.js App Router — admin & worker portal routes, API routes
├── components/     # Reusable UI components (maps, invoice PDF, status badges, etc.)
├── lib/            # Prisma client, AWS/S3 config, utilities
├── prisma/         # schema.prisma (data model)
├── scripts/        # Database seed scripts
├── hooks/          # React hooks
├── types/          # TypeScript type declarations
├── public/         # Static assets
├── Dockerfile
├── docker-compose.yml
├── docker-entrypoint.sh
├── .env.docker.example
└── DOCKER_README.md
```

---

## Security Notes

- The real `.env` file is **gitignored** and must be created from `.env.docker.example`.
- No real credentials, API keys, or secrets are committed to this repository.
- Rotate the default seed passwords and generate a fresh `NEXTAUTH_SECRET` before going live.

---

## License

Proprietary — © Camarillo Investments. All rights reserved.
