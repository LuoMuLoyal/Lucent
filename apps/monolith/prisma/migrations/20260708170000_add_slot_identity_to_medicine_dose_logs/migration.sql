ALTER TABLE "user_medicine_dose_logs"
ADD COLUMN "reminder_id" TEXT,
ADD COLUMN "scheduled_time" VARCHAR(5);

ALTER TABLE "user_medicine_dose_logs"
ADD CONSTRAINT "user_medicine_dose_logs_reminder_id_fkey"
FOREIGN KEY ("reminder_id") REFERENCES "user_medicine_reminders"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "dose_logs_user_reminder_day_idx"
ON "user_medicine_dose_logs"("user_id", "reminder_id", "scheduled_for");

CREATE INDEX "dose_logs_user_medicine_day_time_idx"
ON "user_medicine_dose_logs"(
  "user_id",
  "current_medicine_id",
  "scheduled_for",
  "scheduled_time"
);
