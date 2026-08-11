CREATE TYPE "HealthEventKind" AS ENUM ('symptom', 'other');
CREATE TYPE "TodayAnalysisMaterializationStatus" AS ENUM ('pending', 'ready', 'failed', 'capped');

ALTER TABLE "health_events"
    ADD COLUMN "kind" "HealthEventKind" NOT NULL DEFAULT 'symptom';

ALTER TABLE "assistant_summary_histories"
    ADD COLUMN "source_version" INTEGER;

CREATE TABLE "user_today_analysis_materializations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "local_date" DATE NOT NULL,
    "source_version" INTEGER NOT NULL DEFAULT 0,
    "computed_version" INTEGER NOT NULL DEFAULT 0,
    "status" "TodayAnalysisMaterializationStatus" NOT NULL DEFAULT 'pending',
    "reason_codes" TEXT[] NOT NULL,
    "generation_count" INTEGER NOT NULL DEFAULT 0,
    "active_version" INTEGER,
    "active_at" TIMESTAMPTZ(3),
    "last_manual_at" TIMESTAMPTZ(3),
    "last_trigger_key" TEXT,
    "last_error_code" TEXT,
    "queued_at" TIMESTAMPTZ(3),
    "computed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_today_analysis_materializations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_today_analysis_materializations_user_id_local_date_key"
    ON "user_today_analysis_materializations"("user_id", "local_date");
CREATE INDEX "user_today_analysis_materializations_user_id_status_idx"
    ON "user_today_analysis_materializations"("user_id", "status");

ALTER TABLE "user_today_analysis_materializations"
    ADD CONSTRAINT "user_today_analysis_materializations_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
