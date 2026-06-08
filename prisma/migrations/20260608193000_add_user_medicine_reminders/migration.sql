CREATE TABLE "user_medicine_reminders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "current_medicine_id" TEXT,
    "label" TEXT,
    "scheduled_hour" INTEGER NOT NULL,
    "scheduled_minute" INTEGER NOT NULL,
    "days_of_week" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_medicine_reminders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_medicine_reminders_user_id_is_active_idx" ON "user_medicine_reminders"("user_id", "is_active");

CREATE INDEX "user_medicine_reminders_user_id_current_medicine_id_idx" ON "user_medicine_reminders"("user_id", "current_medicine_id");

CREATE INDEX "user_medicine_reminders_user_id_deleted_at_idx" ON "user_medicine_reminders"("user_id", "deleted_at");

ALTER TABLE "user_medicine_reminders" ADD CONSTRAINT "user_medicine_reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_medicine_reminders" ADD CONSTRAINT "user_medicine_reminders_current_medicine_id_fkey" FOREIGN KEY ("current_medicine_id") REFERENCES "user_current_medicines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
