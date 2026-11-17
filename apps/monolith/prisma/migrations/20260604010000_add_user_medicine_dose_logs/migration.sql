-- CreateEnum
CREATE TYPE "DoseLogStatus" AS ENUM ('taken', 'skipped', 'missed', 'planned');

-- CreateTable
CREATE TABLE "user_medicine_dose_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "current_medicine_id" TEXT,
    "status" "DoseLogStatus" NOT NULL DEFAULT 'planned',
    "scheduled_for" DATE NOT NULL,
    "taken_at" TIMESTAMPTZ(3),
    "doseText" TEXT,
    "note" TEXT,
    "source" TEXT DEFAULT 'manual',
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_medicine_dose_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_medicine_dose_logs_user_id_scheduled_for_idx" ON "user_medicine_dose_logs"("user_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "user_medicine_dose_logs_user_id_current_medicine_id_idx" ON "user_medicine_dose_logs"("user_id", "current_medicine_id");

-- CreateIndex
CREATE INDEX "user_medicine_dose_logs_user_id_deleted_at_idx" ON "user_medicine_dose_logs"("user_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "user_medicine_dose_logs" ADD CONSTRAINT "user_medicine_dose_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_medicine_dose_logs" ADD CONSTRAINT "user_medicine_dose_logs_current_medicine_id_fkey" FOREIGN KEY ("current_medicine_id") REFERENCES "user_current_medicines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
