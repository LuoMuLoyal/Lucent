CREATE TYPE "AiSummaryHistoryKind" AS ENUM ('today', 'report');

CREATE TABLE "ai_summary_histories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "AiSummaryHistoryKind" NOT NULL,
    "scope_key" TEXT NOT NULL,
    "date" DATE,
    "range_key" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "generated_at" TIMESTAMPTZ(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "bullets" JSONB NOT NULL,
    "action_label" TEXT NOT NULL,
    "confidence_note" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_summary_histories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_summary_histories_user_id_scope_key_key" ON "ai_summary_histories"("user_id", "scope_key");
CREATE INDEX "ai_summary_histories_user_id_kind_generated_at_idx" ON "ai_summary_histories"("user_id", "kind", "generated_at");
CREATE INDEX "ai_summary_histories_user_id_date_idx" ON "ai_summary_histories"("user_id", "date");
CREATE INDEX "ai_summary_histories_user_id_range_key_generated_at_idx" ON "ai_summary_histories"("user_id", "range_key", "generated_at");

ALTER TABLE "ai_summary_histories"
ADD CONSTRAINT "ai_summary_histories_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
