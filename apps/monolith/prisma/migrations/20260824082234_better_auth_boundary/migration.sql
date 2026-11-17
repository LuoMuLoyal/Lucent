-- Better Auth boundary convergence migration (Task 5).
-- Materializes the current auth schema: Better Auth core tables, Account extension
-- fields, removal of legacy UserIdentity and old credential/PIN columns on users.
-- Unrelated schema drift detected during generation is NOT included here; see
-- docs/02-logs/migration-log/2026-08-24.md for details.

-- Drop legacy UserIdentity table and its FK first.
ALTER TABLE "user_identities" DROP CONSTRAINT "user_identities_user_id_fkey";
DROP TABLE "user_identities";

-- Remove legacy credential / PIN columns from users and enforce the current
-- User model shape required by the Better Auth integration.
ALTER TABLE "users"
    DROP COLUMN "password_hash",
    DROP COLUMN "security_elevation_version",
    DROP COLUMN "security_pin_changed_at",
    DROP COLUMN "security_pin_enabled",
    DROP COLUMN "security_pin_hash",
    ADD COLUMN "email_verified" BOOLEAN NOT NULL DEFAULT false,
    ALTER COLUMN "email" SET NOT NULL;

-- Better Auth core session table.
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Better Auth / Lucent merged account table (extension fields from Task 4).
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(3),
    "refresh_token_expires_at" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "provider_union_id" TEXT,
    "provider_email" TEXT,
    "provider_email_verified_at" TIMESTAMPTZ(3),
    "raw_profile" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounts_provider_id_account_id_key" ON "accounts"("provider_id", "account_id");
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");
CREATE INDEX "accounts_provider_union_id_idx" ON "accounts"("provider_union_id");
CREATE INDEX "accounts_provider_email_idx" ON "accounts"("provider_email");

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Better Auth verification table.
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");
