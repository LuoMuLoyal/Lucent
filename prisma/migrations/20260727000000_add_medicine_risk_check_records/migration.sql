-- CreateTable
CREATE TABLE IF NOT EXISTS "medicine_risk_check_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "check_type" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "risk_score" INTEGER NOT NULL,
    "risk_level" TEXT NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medicine_risk_check_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "medicine_risk_check_records_user_id_check_type_key"
    ON "medicine_risk_check_records"("user_id", "check_type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "medicine_risk_check_records_user_id_check_type_idx"
    ON "medicine_risk_check_records"("user_id", "check_type");

-- AddForeignKey
ALTER TABLE "medicine_risk_check_records"
    ADD CONSTRAINT "medicine_risk_check_records_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
