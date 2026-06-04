# Backend User Domain

Last updated: 2026-06-04

## Purpose

This document is the current source of truth for Lucent's user-domain persistence model and auth-adjacent storage behavior.

Current boundary:

- `/api/v1/auth/*` stays frontend-compatible and still returns a minimal user shape.
- `GET /api/v1/me/health-context` exposes the authenticated user's health-context aggregate.
- Health-context profile, allergies, conditions, and current medicines are writable through user-scoped `/me/health-context/*` APIs.
- Daily records and medicine dose logs are implemented for manual user logging. They do not provide AI interpretation, push notification scheduling, or automatic adherence plans.

## Current API Surface

### `GET /api/v1/me/health-context`

Auth-protected aggregate read model for the current user.

Returns:

- `summary`
- `profile`
- `allergies`
- `conditions`
- `currentMedicines`

Notes:

- The handler derives the user id from JWT payload and does not accept request-body or query `userId`.
- `profile` always returns a stable object shape even if the legacy relation row is missing.
- `birth_date`, `diagnosed_at`, and medicine start/end dates are exposed as `YYYY-MM-DD`.
- Timestamp fields are exposed as ISO 8601 strings.
- Active allergies and current medicines are filtered at the query layer; conditions currently return the full recorded list.
- This endpoint is intended as the backend second layer for Today and other personalized read experiences.

### Health-context writes

Auth-protected write APIs for the current user's health context:

```text
PATCH  /api/v1/me/health-context/profile
POST   /api/v1/me/health-context/allergies
PATCH  /api/v1/me/health-context/allergies/:id
DELETE /api/v1/me/health-context/allergies/:id
POST   /api/v1/me/health-context/conditions
PATCH  /api/v1/me/health-context/conditions/:id
DELETE /api/v1/me/health-context/conditions/:id
POST   /api/v1/me/health-context/current-medicines
PATCH  /api/v1/me/health-context/current-medicines/:id
DELETE /api/v1/me/health-context/current-medicines/:id
```

Notes:

- Handlers derive the user id from JWT payload and reject foreign record ids as not found.
- Profile writes use upsert semantics and return the refreshed aggregate payload.
- Nullable fields distinguish omitted/no-change from explicit `null` clearing.
- Allergy and current-medicine deletes are soft state changes (`isActive=false`, `isCurrent=false`).
- Condition delete resolves the condition and preserves an existing `resolvedAt` value.

### Daily records

Auth-protected manual daily timeline APIs:

```text
GET    /api/v1/me/daily-records?date=YYYY-MM-DD&kind=&page=1&pageSize=50
POST   /api/v1/me/daily-records
PATCH  /api/v1/me/daily-records/:id
DELETE /api/v1/me/daily-records/:id
GET    /api/v1/me/daily-records/summary?date=YYYY-MM-DD
```

Notes:

- All records are scoped to `CurrentUser.sub`.
- `PATCH` uses omitted/no-change semantics and explicit `null` to clear nullable fields.
- `DELETE` soft-deletes via `deletedAt`.
- Summary returns per-kind counts and the latest record for the requested date.

### Medicine dose logs

Auth-protected manual adherence log APIs:

```text
GET    /api/v1/me/medicine-dose-logs?date=YYYY-MM-DD
POST   /api/v1/me/medicine-dose-logs
PATCH  /api/v1/me/medicine-dose-logs/:id
DELETE /api/v1/me/medicine-dose-logs/:id
```

Notes:

- Dose-log statuses are `taken`, `skipped`, `missed`, and `planned`.
- `currentMedicineId`, when present, must belong to the current user.
- `PATCH` supports omitted/no-change and explicit `null` clearing for nullable text fields.
- `DELETE` soft-deletes via `deletedAt`.
- This is manual logging only; no push reminder scheduling is implied.

## Design Principles

- Keep the existing auth API contract stable while the backend evolves underneath it.
- Use PostgreSQL features pragmatically where they reduce complexity or improve integrity.
- Keep all user-owned health context under one user identity boundary.
- Avoid multi-schema or over-abstracted storage until there is a real operational need.

## Current Models

### `users`

Core identity and auth state.

Key fields:

- `email`
- `password_hash`
- `status`
- `email_verified_at`
- `last_login_at`
- `deleted_at`
- `created_at`
- `updated_at`

Notes:

- Emails are treated case-insensitively by the service layer and normalized before lookup/persistence.
- Soft delete is represented by `deleted_at` plus `status = deleted`.
- Auth responses still expose `emailVerified: boolean`; persistence uses `email_verified_at`.

### `user_profiles`

One-to-one demographic and preference context for a user.

Key fields:

- `birth_date`
- `sex_at_birth`
- `height_cm`
- `pregnancy_state`
- `lactation_state`
- `blood_type`
- `locale`
- `timezone`
- `unit_system`
- `onboarding_completed_at`
- `extras` (`jsonb`)

Notes:

- A blank profile row is created automatically when a user is created.
- `extras` is reserved for sparse or low-frequency profile extensions that do not yet justify first-class columns.

### `user_sessions`

Refresh-session persistence for multi-device auth.

Key fields:

- `refresh_token_hash`
- `device_type`
- `device_name`
- `platform`
- `app_version`
- `ip_address`
- `user_agent`
- `context` (`jsonb`)
- `last_used_at`
- `expires_at`
- `revoked_at`

Notes:

- Lucent returns the plaintext refresh token once, but stores only a SHA-256 hash in the database.
- `refresh` rotates only the session used by that token.
- `logoutAll`, password reset, and password change revoke all persisted refresh sessions for the user.

### `user_devices`

Device and notification registration data.

Key fields:

- `platform`
- `device_name`
- `push_token`
- `locale`
- `timezone`
- `notifications_enabled`
- `capabilities` (`jsonb`)
- `last_seen_at`

### `user_allergies`

User-owned allergy context for medication safety and future Today/personalization features.

Key fields:

- `kind`
- `label`
- `reaction`
- `severity`
- `is_active`
- `note`
- `extras` (`jsonb`)
- `recorded_at`

### `user_conditions`

User-owned condition history.

Key fields:

- `label`
- `status`
- `diagnosed_at`
- `resolved_at`
- `note`
- `extras` (`jsonb`)

### `user_current_medicines`

Current medicine context linked to a user, independent from the upstream knowledge source.

Key fields:

- `source`
- `source_ref_id`
- `display_name`
- `strength_text`
- `dose_text`
- `route`
- `started_at`
- `ended_at`
- `is_current`
- `note`
- `source_payload` (`jsonb`)

### `user_daily_records`

User-owned daily timeline records for lightweight manual health tracking.

Key fields:

- `kind` — enum: `water`, `meal`, `vital`, `mood`, `symptom`, `activity`, `note`.
- `occurred_at` — date the record is associated with (`@db.Date`).
- `title` — optional short label for display.
- `value` — optional measured value as a string (e.g. `"72"`, `"118/76"`).
- `unit` — optional unit label (e.g. `"bpm"`, `"cups"`).
- `note` — optional free-text note.
- `payload` — optional jsonb for future structured extensions.
- `source` — defaults to `"manual"`.
- `deleted_at` — soft-delete timestamp.

Notes:

- Isolated per user via `userId` with cascade delete.
- Indexed on `(userId, occurredAt)`, `(userId, kind)`, `(userId, deletedAt)`.
- No AI interpretation, diagnosis, or nutrition inference.
- Migration: `prisma/migrations/20260604000000_add_user_daily_records`.

### `user_medicine_dose_logs`

User-owned manual medicine adherence logs.

Key fields:

- `current_medicine_id` — optional link to a current medicine owned by the same user.
- `status` — enum: `taken`, `skipped`, `missed`, `planned`.
- `scheduled_for` — date the log is associated with (`@db.Date`).
- `taken_at` — optional timestamp for future richer adherence flows.
- `doseText` — optional dose text. The current Prisma schema intentionally maps this to the database column `"doseText"`.
- `note` — optional free-text note.
- `source` — defaults to `"manual"`.
- `deleted_at` — soft-delete timestamp.

Notes:

- Isolated per user via `userId` with cascade delete.
- Optional current-medicine link uses `ON DELETE SET NULL`.
- Indexed on `(userId, scheduledFor)`, `(userId, currentMedicineId)`, `(userId, deletedAt)`.
- Migration: `prisma/migrations/20260604010000_add_user_medicine_dose_logs`.

## PostgreSQL Features In Use

- `enum` types for user status, sex at birth, pregnancy/lactation state, session/device metadata, allergy metadata, condition status, and medicine source.
- `jsonb` for sparse/extensible payloads such as profile extras, session context, device capabilities, and source payloads.
- Partial unique index on active email:
  - `unique lower(email) where deleted_at is null`
- `timestamptz(3)` for audit and session timestamps.
- `date` for inherently day-level medical dates such as birth date, diagnosis date, and medicine start/end dates.
- Check constraints for:
  - positive `height_cm`
  - `resolved_at >= diagnosed_at`
  - `ended_at >= started_at`

## Auth Compatibility Layer

External auth API shape remains intentionally small:

- `register`, `login`, and `me` still return a minimal user object.
- `emailVerified` remains a boolean in API responses for frontend compatibility.
- No health-profile payload is returned from `/auth/me` yet.

Internal behavior already changed:

- `password` is persisted as `password_hash`.
- `emailVerified` is persisted as `email_verified_at`.
- refresh-token persistence moved from legacy `refresh_tokens` rows to richer `user_sessions`.

## Environment And Migration Notes

- Prisma CLI now follows `NODE_ENV` and mirrors the app's env-file resolution:
  - `.env.<NODE_ENV>.local`
  - `.env.<NODE_ENV>`
  - `.env`
- The migration that introduces this user-domain expansion is:
  - `prisma/migrations/20260530183000_expand_user_domain`
- Local e2e expects the test database to have that migration applied before running auth integration tests.

## Deliberately Not Done Yet

- No separate public profile endpoints yet.
- No PostgreSQL schema split or row-level security yet.
- No session-management UI/API for listing devices or revoking individual sessions by id.
- No push notification scheduling or automatic reminder engine for dose logs yet.
- No AI interpretation, diagnosis, nutrition inference, OCR, or wearable-sync ingestion for daily records or dose logs yet.

Next pieces should land as feature-first modules around writes, editing flows, and more granular Today-specific projections when the frontend begins integrating live data.
