ALTER TABLE "user_medicine_reminders"
ADD COLUMN "start_date" DATE,
ADD COLUMN "end_date" DATE;

CREATE INDEX "user_medicine_reminders_user_id_start_date_end_date_idx" ON "user_medicine_reminders"("user_id", "start_date", "end_date");

CREATE TABLE "user_reminder_deliveries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reminder_id" TEXT,
    "device_id" TEXT,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
    "delivered_at" TIMESTAMPTZ(3),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_reminder_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_reminder_deliveries_user_id_scheduled_for_idx" ON "user_reminder_deliveries"("user_id", "scheduled_for");

CREATE INDEX "user_reminder_deliveries_user_id_reminder_id_idx" ON "user_reminder_deliveries"("user_id", "reminder_id");

CREATE INDEX "user_reminder_deliveries_user_id_channel_status_idx" ON "user_reminder_deliveries"("user_id", "channel", "status");

ALTER TABLE "user_reminder_deliveries" ADD CONSTRAINT "user_reminder_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_reminder_deliveries" ADD CONSTRAINT "user_reminder_deliveries_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "user_medicine_reminders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
