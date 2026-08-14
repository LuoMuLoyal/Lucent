-- CreateEnum
CREATE TYPE "ClinicSummaryShareField" AS ENUM ('event_overview', 'symptom_changes', 'medication_slots', 'water', 'sleep', 'notes');

-- CreateTable
CREATE TABLE "user_clinic_summary_shares" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "event_id" TEXT,
    "date_from" DATE,
    "date_to" DATE,
    "selected_fields" "ClinicSummaryShareField"[],
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "first_accessed_at" TIMESTAMPTZ(3),
    "last_accessed_at" TIMESTAMPTZ(3),
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_clinic_summary_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_clinic_summary_shares_token_hash_key" ON "user_clinic_summary_shares"("token_hash");

-- CreateIndex
CREATE INDEX "user_clinic_summary_shares_user_id_created_at_idx" ON "user_clinic_summary_shares"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "user_clinic_summary_shares" ADD CONSTRAINT "user_clinic_summary_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
