# Backend User Domain

Last updated: 2026-06-04

## Purpose

This document is the current source of truth for Lucent's user-domain persistence model and auth-adjacent storage behavior.

Current boundary:

- `/api/v1/auth/*` stays frontend-compatible and still returns a minimal user shape.
- `GET /api/v1/me/health-context` now exposes a read-only aggregate for the authenticated user's health context.
- Rich personal health context is modeled in the database, but write APIs are still not exposed yet.

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

User-owned daily timeline records for lightweight manual health tracking. This model is schema-only for now; no APIs exist yet.

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

- No write APIs yet for profile, allergies, conditions, or current medicines.
- No separate public profile endpoints yet.
- No PostgreSQL schema split or row-level security yet.
- No session-management UI/API for listing devices or revoking individual sessions by id.

Next pieces should land as feature-first modules around writes, editing flows, and more granular Today-specific projections when the frontend begins integrating live data.
