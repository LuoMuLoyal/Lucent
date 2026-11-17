ALTER TABLE "user_daily_records"
ADD COLUMN "occurred_time" VARCHAR(5);

CREATE INDEX "user_daily_records_user_id_occurred_at_occurred_time_idx"
ON "user_daily_records"("user_id", "occurred_at", "occurred_time");
