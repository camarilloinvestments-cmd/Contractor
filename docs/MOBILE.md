# OS1 Fiber Track Pro - Mobile Application Architecture

> Workstreams P (mobile foundation), Q (offline sync) and R (field evidence).
> This document describes the **server-authoritative** mobile foundation that
> ships inside this repository, and the companion native app that consumes it.

## 1. Design principles

- **Server is authoritative.** No billing, payout, geofence-threshold or
  approval rules live in the mobile client. The device sends raw field facts
  (production quantity, GPS, photos, signatures); the server recomputes every
  monetary value from the task's own stored `billingRate` / `workerPayoutRate`
  (cents per unit). The device never transmits rates or amounts.
- **Offline-first.** The device owns a local queue. Every queued record carries
  a client `localUuid` and an `idempotencyKey`; the server de-duplicates on
  replay so a flaky connection can never double-apply work.
- **GPS is mandatory-but-flagged.** Missing or failed coordinates never reject a
  worker's evidence; they are recorded with geofence status `UNKNOWN` for office
  review (see `lib/mobile/geofence.ts`).
- **One official API.** The mobile app consumes the same HTTP API as every other
  client. Mobile uses per-user, per-device bearer tokens (prefix `os1_mob_`);
  server-to-server integrations use API keys (prefix `os1_sk_`, Workstream W).

## 2. Native app target

- **React Native + Expo** (dev-client / EAS builds) targeting iOS and Android.
- The native project is developed and built outside this VM (a native toolchain
  is required). This repository ships the **entire server contract** the app
  needs: authentication, device management, data feeds, offline sync ledger,
  field-evidence intake and payout visibility.

## 3. Data model (migration `0011_mobile_evidence_sync`, additive)

| Model | Purpose |
|-------|---------|
| `MobileDevice` | One row per physical device (`deviceUuid` unique). Platform, model, push token, status (`ACTIVE`/`REVOKED`). |
| `MobileSession` | Issued bearer session. Only the SHA-256 `tokenHash` is stored; plaintext token is returned to the device once. 30-day TTL. Cascades on device delete. |
| `MobileSyncEvent` | Idempotent offline-sync ledger (`idempotencyKey` unique, `@@unique([deviceId, localUuid])`). |
| `FieldEvidencePackage` | A worker's on-site evidence submission (`localUuid` unique): GPS + geofence result, production, signature, status. |
| `EvidenceAsset` | Photo/document attached to a package (`localUuid` unique, cascades on package delete). |

Enums: `DevicePlatform`, `DeviceStatus`, `SyncEntityType`, `SyncResult`,
`GeofenceStatus`, `EvidenceKind`, `EvidenceStatus`.

## 4. Authentication & sessions (P)

- `POST /api/mobile/auth/login` - email + password (bcrypt) + optional MFA TOTP.
  Requires `deviceUuid`. Registers/updates the device, revokes prior sessions,
  issues a new `os1_mob_` token + `expiresAt`. Audited as `mobile.login`.
- `POST /api/mobile/auth/logout` - revokes the current session (`mobile.logout`).
- `GET /api/mobile/me` - current user + worker + crew + device + server version.
- All authenticated mobile routes call `verifyMobileSession(req)` which validates
  the bearer token hash, checks expiry/revocation, and returns a `MobileContext`.

### Device management (admin)
- `GET /api/system/devices` - ADMIN inventory of devices, owners and live sessions.
- `POST /api/system/devices/{id}/revoke` - ADMIN kills a device and all its
  sessions (`system.device_revoke`).

## 5. Data feeds

- `GET /api/mobile/jobs` - role-scoped assigned jobs.
- `GET /api/mobile/tasks?jobId=` - role-scoped assigned tasks with task type,
  unit and job geo fields.
- `POST /api/mobile/tasks/{id}/status` - start/pause/complete + optional
  `productionQuantity`. Server recomputes `billableAmount`, `costAmount`,
  `profitAmount` from the task's own rates. Workers may only touch their own
  tasks. Last-write-wins conflict check via `detectConflict`.
- `GET /api/mobile/payouts` - the worker's OWN payout records only.

## 6. Offline queue & sync (Q)

Each queued record on the device carries: `localUuid`, `idempotencyKey`,
`entityType` (`SyncEntityType`), device/created timestamps, `retryCount`,
`syncState`, `lastError`, `serverAck`, `conflictStatus`.

- `POST /api/mobile/sync` - flushes a batch (<= 500). Each record is recorded in
  the idempotent ledger; a replayed `idempotencyKey` returns a `DUPLICATE` ack
  instead of a second row. Response is an `acks[]` array with per-record
  `result` (`ACCEPTED` / `DUPLICATE` / `CONFLICT` / `REJECTED`).
- Conflicts use last-write-wins: `detectConflict(serverUpdatedAt, deviceTimestamp)`
  returns `server_newer` when the server copy is newer than the device capture.

## 7. Field Evidence Package (R)

- `POST /api/mobile/evidence` - idempotent by `localUuid`. Evaluates the job
  geofence (`INSIDE` / `OUTSIDE` / `UNKNOWN` / `NO_GEOFENCE`), denormalizes the
  subcontractor company, and stores photos/documents as `EvidenceAsset` rows
  (cloud storage paths; binaries uploaded via presigned URLs). Audited as
  `mobile.evidence_submit`.
- `GET /api/mobile/evidence` - the worker's own submissions.
- `GET /api/evidence` - ADMIN / PROJECT_MANAGER review list (filter `jobId`,
  `status`) with assets, job, worker and task context.

## 8. Security notes

- Session tokens: only SHA-256 hashes are stored; the plaintext is shown to the
  device exactly once at login.
- Push tokens are opaque routing identifiers, not secrets.
- MFA-enabled accounts must pass TOTP at mobile login, mirroring the web flow.
- Revoking a device immediately invalidates every session bound to it.
