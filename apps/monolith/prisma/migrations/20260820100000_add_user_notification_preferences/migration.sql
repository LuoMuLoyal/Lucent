CREATE TABLE "user_notification_preferences" (
    "user_id" TEXT NOT NULL,
    "health_alerts_enabled" BOOLEAN NOT NULL DEFAULT true,
    "weekly_insight_enabled" BOOLEAN NOT NULL DEFAULT false,
    "water_reminders_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sleep_reminder_enabled" BOOLEAN NOT NULL DEFAULT false,
    "sleep_bedtime_minutes" INTEGER,
    "sleep_wake_time_minutes" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_notification_preferences_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "user_notification_preferences"
ADD CONSTRAINT "user_notification_preferences_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_notifications" ADD COLUMN "scope_key" TEXT;

CREATE UNIQUE INDEX "user_notifications_user_id_type_scope_key_key"
ON "user_notifications"("user_id", "type", "scope_key");
