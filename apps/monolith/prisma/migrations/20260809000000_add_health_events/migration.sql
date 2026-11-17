-- CreateEnum
CREATE TYPE "HealthEventStatus" AS ENUM ('active', 'ended');

-- CreateEnum
CREATE TYPE "HealthEventOutcome" AS ENUM ('improved', 'unchanged', 'worsened');

-- CreateTable
CREATE TABLE "health_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "HealthEventStatus" NOT NULL DEFAULT 'active',
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "outcome" "HealthEventOutcome",
    "reason_record_id" TEXT,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_event_check_ins" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "outcome" "HealthEventOutcome" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_event_check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_event_medicines" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "current_medicine_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_event_medicines_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "user_daily_records" ADD COLUMN "health_event_id" TEXT;

-- AlterTable
ALTER TABLE "user_medicine_dose_logs" ADD COLUMN "health_event_id" TEXT;

-- CreateIndex
CREATE INDEX "health_events_user_id_status_started_at_idx" ON "health_events"("user_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "health_events_user_id_deleted_at_idx" ON "health_events"("user_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "health_event_check_ins_event_id_date_key" ON "health_event_check_ins"("event_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "health_event_medicines_event_id_current_medicine_id_key" ON "health_event_medicines"("event_id", "current_medicine_id");

-- CreateIndex
CREATE INDEX "user_daily_records_user_id_health_event_id_idx" ON "user_daily_records"("user_id", "health_event_id");

-- CreateIndex
CREATE INDEX "user_medicine_dose_logs_user_id_health_event_id_idx" ON "user_medicine_dose_logs"("user_id", "health_event_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "health_events_one_active_per_user_idx"
    ON "health_events"("user_id")
    WHERE "status" = 'active' AND "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "health_events"
    ADD CONSTRAINT "health_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_events"
    ADD CONSTRAINT "health_events_reason_record_id_fkey"
    FOREIGN KEY ("reason_record_id") REFERENCES "user_daily_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_event_check_ins"
    ADD CONSTRAINT "health_event_check_ins_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "health_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_event_medicines"
    ADD CONSTRAINT "health_event_medicines_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "health_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_event_medicines"
    ADD CONSTRAINT "health_event_medicines_current_medicine_id_fkey"
    FOREIGN KEY ("current_medicine_id") REFERENCES "user_current_medicines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_daily_records"
    ADD CONSTRAINT "user_daily_records_health_event_id_fkey"
    FOREIGN KEY ("health_event_id") REFERENCES "health_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_medicine_dose_logs"
    ADD CONSTRAINT "user_medicine_dose_logs_health_event_id_fkey"
    FOREIGN KEY ("health_event_id") REFERENCES "health_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
