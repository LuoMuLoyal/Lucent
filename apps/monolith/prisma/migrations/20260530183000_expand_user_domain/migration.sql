-- Create enums
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended', 'deleted');
CREATE TYPE "SexAtBirth" AS ENUM ('female', 'male', 'intersex', 'unknown');
CREATE TYPE "PregnancyState" AS ENUM ('not_applicable', 'unknown', 'not_pregnant', 'pregnant', 'trying', 'postpartum');
CREATE TYPE "LactationState" AS ENUM ('not_applicable', 'unknown', 'no', 'yes');
CREATE TYPE "UnitSystem" AS ENUM ('metric', 'imperial');
CREATE TYPE "UserSessionDeviceType" AS ENUM ('mobile', 'tablet', 'desktop', 'web', 'watch', 'server', 'other');
CREATE TYPE "UserDevicePlatform" AS ENUM ('ios', 'android', 'web', 'windows', 'macos', 'linux', 'watchos', 'other');
CREATE TYPE "UserAllergyKind" AS ENUM ('drug', 'food', 'environment', 'other');
CREATE TYPE "UserAllergySeverity" AS ENUM ('mild', 'moderate', 'severe', 'unknown');
CREATE TYPE "UserConditionStatus" AS ENUM ('active', 'resolved', 'suspected');
CREATE TYPE "MedicineSource" AS ENUM ('drugbank', 'cn', 'manual');

-- Rename core user columns to durable snake_case storage
ALTER TABLE "users" RENAME COLUMN "password" TO "password_hash";
ALTER TABLE "users" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "users" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "users" RENAME COLUMN "updatedAt" TO "updated_at";

ALTER TABLE "users"
  ALTER COLUMN "deleted_at" TYPE TIMESTAMPTZ(3) USING "deleted_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

ALTER TABLE "users"
  ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "email_verified_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_login_at" TIMESTAMPTZ(3);

UPDATE "users"
SET
  "email_verified_at" = CASE
    WHEN "emailVerified" = true THEN "created_at"
    ELSE NULL
  END,
  "status" = CASE
    WHEN "deleted_at" IS NULL THEN 'active'::"UserStatus"
    ELSE 'deleted'::"UserStatus"
  END;

ALTER TABLE "users" DROP COLUMN "emailVerified";

DROP INDEX "users_email_key";
CREATE INDEX "users_email_idx" ON "users"("email");
CREATE INDEX "users_status_idx" ON "users"("status");
CREATE UNIQUE INDEX "users_email_active_unique" ON "users"(LOWER("email")) WHERE "deleted_at" IS NULL;

-- New user domain tables
CREATE TABLE "user_profiles" (
  "user_id" TEXT NOT NULL,
  "birth_date" DATE,
  "sex_at_birth" "SexAtBirth",
  "height_cm" INTEGER,
  "pregnancy_state" "PregnancyState",
  "lactation_state" "LactationState",
  "blood_type" TEXT,
  "locale" TEXT,
  "timezone" TEXT,
  "unit_system" "UnitSystem",
  "onboarding_completed_at" TIMESTAMPTZ(3),
  "extras" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_profiles_height_cm_check" CHECK ("height_cm" IS NULL OR "height_cm" > 0)
);

CREATE TABLE "user_sessions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "refresh_token_hash" TEXT NOT NULL,
  "device_type" "UserSessionDeviceType",
  "device_name" TEXT,
  "platform" "UserDevicePlatform",
  "app_version" TEXT,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "context" JSONB,
  "last_used_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "user_sessions_refresh_token_hash_key" ON "user_sessions"("refresh_token_hash");
CREATE INDEX "user_sessions_user_id_revoked_at_idx" ON "user_sessions"("user_id", "revoked_at");
CREATE INDEX "user_sessions_user_id_expires_at_idx" ON "user_sessions"("user_id", "expires_at");

CREATE TABLE "user_devices" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "platform" "UserDevicePlatform" NOT NULL,
  "device_name" TEXT,
  "push_token" TEXT,
  "locale" TEXT,
  "timezone" TEXT,
  "notifications_enabled" BOOLEAN NOT NULL DEFAULT false,
  "capabilities" JSONB,
  "last_seen_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "user_devices_push_token_key" ON "user_devices"("push_token");
CREATE INDEX "user_devices_user_id_platform_idx" ON "user_devices"("user_id", "platform");

CREATE TABLE "user_allergies" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "kind" "UserAllergyKind" NOT NULL,
  "label" TEXT NOT NULL,
  "reaction" TEXT,
  "severity" "UserAllergySeverity" DEFAULT 'unknown',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "note" TEXT,
  "extras" JSONB,
  "recorded_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_allergies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_allergies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "user_allergies_user_id_is_active_idx" ON "user_allergies"("user_id", "is_active");

CREATE TABLE "user_conditions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "status" "UserConditionStatus" NOT NULL DEFAULT 'active',
  "diagnosed_at" DATE,
  "resolved_at" DATE,
  "note" TEXT,
  "extras" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_conditions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_conditions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_conditions_dates_check" CHECK ("resolved_at" IS NULL OR "diagnosed_at" IS NULL OR "resolved_at" >= "diagnosed_at")
);

CREATE INDEX "user_conditions_user_id_status_idx" ON "user_conditions"("user_id", "status");

CREATE TABLE "user_current_medicines" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "source" "MedicineSource" NOT NULL,
  "source_ref_id" TEXT,
  "display_name" TEXT NOT NULL,
  "strength_text" TEXT,
  "dose_text" TEXT,
  "route" TEXT,
  "started_at" DATE,
  "ended_at" DATE,
  "is_current" BOOLEAN NOT NULL DEFAULT true,
  "note" TEXT,
  "source_payload" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_current_medicines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_current_medicines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_current_medicines_dates_check" CHECK ("ended_at" IS NULL OR "started_at" IS NULL OR "ended_at" >= "started_at")
);

CREATE INDEX "user_current_medicines_user_id_is_current_idx" ON "user_current_medicines"("user_id", "is_current");
CREATE INDEX "user_current_medicines_user_id_source_idx" ON "user_current_medicines"("user_id", "source");

-- Seed a profile row for every existing user
INSERT INTO "user_profiles" ("user_id")
SELECT "id"
FROM "users"
ON CONFLICT ("user_id") DO NOTHING;

-- Old session rows are intentionally dropped because auth now rotates to hashed user_sessions.
DROP TABLE "refresh_tokens";
