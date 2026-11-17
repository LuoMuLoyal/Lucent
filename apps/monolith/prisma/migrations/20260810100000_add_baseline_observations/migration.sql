-- CreateTable
CREATE TABLE "user_suggestion_baseline_observations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "dimension" "BaselineDimension" NOT NULL,
    "local_date" DATE NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_suggestion_baseline_observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_suggestion_baseline_observations_user_id_dimension_local_date_key"
    ON "user_suggestion_baseline_observations"("user_id", "dimension", "local_date");

-- CreateIndex
CREATE INDEX "user_suggestion_baseline_observations_user_id_dimension_idx"
    ON "user_suggestion_baseline_observations"("user_id", "dimension");

-- AddForeignKey
ALTER TABLE "user_suggestion_baseline_observations"
    ADD CONSTRAINT "user_suggestion_baseline_observations_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
