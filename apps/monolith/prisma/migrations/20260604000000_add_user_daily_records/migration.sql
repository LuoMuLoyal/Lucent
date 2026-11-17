-- CreateEnum
CREATE TYPE "DailyRecordKind" AS ENUM ('water', 'meal', 'vital', 'mood', 'symptom', 'activity', 'note');

-- CreateTable
CREATE TABLE "user_daily_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "DailyRecordKind" NOT NULL,
    "occurred_at" DATE NOT NULL,
    "title" TEXT,
    "value" TEXT,
    "unit" TEXT,
    "note" TEXT,
    "payload" JSONB,
    "source" TEXT DEFAULT 'manual',
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_daily_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_daily_records_user_id_occurred_at_idx" ON "user_daily_records"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "user_daily_records_user_id_kind_idx" ON "user_daily_records"("user_id", "kind");

-- CreateIndex
CREATE INDEX "user_daily_records_user_id_deleted_at_idx" ON "user_daily_records"("user_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "user_daily_records" ADD CONSTRAINT "user_daily_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
