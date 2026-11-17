-- Replaces 2FA columns with Security PIN and elevation-version columns.
-- Data loss is intentional: existing 2FA secrets and recovery codes are discarded.

ALTER TABLE "users"
  DROP COLUMN "two_factor_enabled",
  DROP COLUMN "two_factor_secret",
  DROP COLUMN "two_factor_recovery_codes",
  ADD COLUMN "security_pin_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "security_pin_hash" TEXT,
  ADD COLUMN "security_pin_changed_at" TIMESTAMPTZ(3),
  ADD COLUMN "security_elevation_version" INTEGER NOT NULL DEFAULT 0;
