-- CreateEnum
CREATE TYPE "SuggestionMaterializationStatus" AS ENUM ('pending', 'ready', 'failed');

-- CreateTable
CREATE TABLE "user_suggestion_materializations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "local_date" DATE NOT NULL,
    "source_version" INTEGER NOT NULL DEFAULT 0,
    "computed_version" INTEGER NOT NULL DEFAULT 0,
    "status" "SuggestionMaterializationStatus" NOT NULL DEFAULT 'pending',
    "reason_codes" TEXT[] NOT NULL,
    "last_error_code" TEXT,
    "queued_at" TIMESTAMPTZ(3),
    "computed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_suggestion_materializations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_suggestion_materializations_user_id_local_date_key"
    ON "user_suggestion_materializations"("user_id", "local_date");

-- CreateIndex
CREATE INDEX "user_suggestion_materializations_user_id_status_idx"
    ON "user_suggestion_materializations"("user_id", "status");

-- AddForeignKey
ALTER TABLE "user_suggestion_materializations"
    ADD CONSTRAINT "user_suggestion_materializations_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
