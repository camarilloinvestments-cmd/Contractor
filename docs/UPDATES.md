# System Update Center — Architecture & Operator Runbook

**Applies to:** OS1 Fiber Track Pro v1.2.0 and later
**Audience:** operators self-hosting via Docker; release engineers cutting releases

The **System Update Center** (Workstreams S/T/U) lets an administrator check for,
verify, and install new releases of OS1 Fiber Track Pro — from the project's
**private** GitHub repository or from a manually uploaded package — with a
signed-manifest guarantee that the app **never installs an unverified package**.

---

## 1. Design: in-app control plane vs. host installer

A containerized Node app **cannot safely swap its own image or restart itself**.
So the feature is split into two cooperating halves, and the boundary is
deliberate and honest:

| In-app control plane (this web app) | Host installer (`scripts/install-update.sh`) |
|-------------------------------------|-----------------------------------------------|
| Store update settings (channel, token, keys) | Re-verify the package checksum on the host |
| Check GitHub for a newer release | Take a database backup |
| Download / accept an uploaded package | Snapshot the current deployment for rollback |
| **Verify** checksum + signature against the manifest | Toggle maintenance mode on |
| **Preflight** (DB up, newer version, min-supported) | Stage the new package, rebuild the image |
| Write a non-secret **install plan** | Run `prisma migrate deploy` |
| Record **update history** & audit events | Health-check `/api/health` |
| Toggle the **maintenance flag** | **Auto-rollback** on any failure |

The web app does everything that can be done safely from inside the container and
leaves the privileged steps (rebuild, migrate, restart) to a script the operator
runs on the Docker host. Both halves run the **same** verification, so a package
can never reach `docker compose up` unverified.

---

## 2. The "never installs an unverified package" guarantee

Every package is described by a **manifest** (`manifest.json`) that travels with
it. Verification (`lib/updates/manifest.ts`) is enforced in the download, upload,
install and retry paths:

- **Checksum — always.** The SHA-256 of the package is compared to the manifest
  value with a **constant-time** compare. A downloaded package whose checksum
  does not match is **deleted immediately**.
- **Signature — when a key is configured.** If a public key is set in settings, or
  `requireSignature` is enabled, the manifest signature (**RSA-SHA256** or
  **ed25519**) must verify over the canonical manifest bytes. The canonical form
  is the manifest JSON with the signature fields removed, keys sorted, compact
  separators — identical in the app (`canonicalManifestBytes`) and in the release
  script (`scripts/release/make-manifest.mjs`).
- **Manual uploads use the same path.** An air-gapped upload is verified exactly
  like a GitHub download — there is no "trusted" shortcut.

If verification fails, the action is recorded as `FAILED` in update history and
the package is not staged.

---

## 3. Cutting a release (release engineer)

### 3.1 Generate a signing key (once)

```bash
# RSA (recommended)
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out release-private.pem
openssl rsa -in release-private.pem -pubout -out release-public.pem

# or ed25519
openssl genpkey -algorithm ed25519 -out release-private.pem
openssl pkey -in release-private.pem -pubout -out release-public.pem
```

Keep `release-private.pem` **off** the repo and out of any image. Paste the
contents of `release-public.pem` into **System → System Updates → Settings →
Release public key** so downloaded packages are signature-checked.

### 3.2 Build a release package

```bash
scripts/build-release.sh \
  --channel RC \
  --min 1.1.0 \
  --notes-file docs/release-notes/v1.2.0-rc.1.md \
  --private-key release-private.pem \
  --algo rsa \
  --out dist/releases
```

This produces, for the current `package.json` version:

- `os1-fiber-track-pro-<version>.tar.gz` — the package (`git archive`)
- `release-notes.md` — human-readable notes
- `manifest.json` — version, channel, minimum-supported version, size, SHA-256,
  and signature (built & signed by `scripts/release/make-manifest.mjs`)
- `SHA256SUMS` — checksums for all artifacts

### 3.3 Publish to GitHub

Create a GitHub **Release** whose tag matches the version and upload all four
artifacts as release assets. The repository is **private**; the app downloads
assets with a `Bearer` token and `Accept: application/octet-stream`.

---

## 4. Configuring the app (administrator)

**System → System Updates → Settings:**

- **Release channel** — `STABLE`, `RC`, or `BETA`. Only releases matching the
  channel (and newer than the running version) are offered.
- **Source** — `GITHUB` (default) or `MANUAL` (upload only).
- **GitHub owner / repo** — e.g. `camarilloinvestments-cmd` / `Contractor`.
- **GitHub token** — a fine-grained PAT with **read** access to the private repo's
  contents/releases. Stored **encrypted at rest**; the status API only ever
  reports `hasToken: true/false` and the token is **never** returned to the
  browser or written to logs.
- **Release public key** — PEM public key for signature verification (optional but
  strongly recommended).
- **Require signature** — when on, a package with no valid signature is rejected
  even if no public key change is pending.

Use **Test connection** to confirm the token and repo are reachable before
relying on automatic checks.

---

## 5. Installing an update (administrator + operator)

1. **Check for updates** (app) — queries GitHub, compares versions/channel, and
   shows the newest eligible release with its notes.
2. **Download** (app) — fetches the asset, verifies checksum (+ signature), and
   stages it under `data/updates/staging`. Unverified downloads are deleted.
   *(Air-gapped: use **Upload package** instead — same verification.)*
3. **Install** (app) — re-verifies the staged package, runs **preflight**, writes
   a non-secret **install plan**, and turns **maintenance mode on**. This does
   **not** restart the container.
4. **Run the host installer** (operator, on the Docker host):

   ```bash
   sudo scripts/install-update.sh
   ```

   It re-verifies the checksum, backs up the database, snapshots the current
   deployment, stages the package, rebuilds the image, runs
   `prisma migrate deploy`, and health-checks `/api/health`. **On any failure it
   automatically rolls back** to the snapshot and restores the database.

5. **Verify** — the app's version banner and update history show the new version
   with result `SUCCESS`; maintenance mode clears.

---

## 6. Rolling back

- **From the app:** **Roll back** records intent and flips maintenance on.
- **On the host:** run the actual rollback:

  ```bash
  sudo scripts/install-update.sh --rollback
  ```

  This restores the previous deployment snapshot and the database backup taken
  before the last install. See also `docs/MIGRATIONS.md` for schema-level
  rollback considerations.

---

## 7. Files & storage

| Path | Purpose |
|------|---------|
| `data/updates/staging` | Downloaded/uploaded packages awaiting install (git-ignored) |
| `data/updates/backups` | Deployment snapshots / DB backups for rollback (git-ignored) |
| `lib/updates/*` | semver, manifest verification, GitHub client, installer helpers |
| `app/api/system/updates/*` | ADMIN-only, `force-dynamic` control-plane API routes |
| `app/(admin)/system/updates` | The System Updates admin page |
| `scripts/build-release.sh` | Build + sign a release package |
| `scripts/release/make-manifest.mjs` | Build & sign `manifest.json` |
| `scripts/install-update.sh` | Host-level safe installer / `--rollback` |

`data/updates/` is **git-ignored** — packages and backups are never committed.

---

## 8. Security notes

- The GitHub token and any secrets are **encrypted at rest** (`lib/crypto`,
  `APP_ENCRYPTION_KEY`), never returned to the browser, never logged.
- All update actions are **ADMIN-only** and recorded in the global audit trail
  (`system.update_check` / `_download` / `_install` / `_rollback` / `_upload` /
  `_retry` / `_settings` / `_test_connection` / `_maintenance`).
- The repository stays **private**; release assets are pulled with an
  authenticated `Bearer` request.
