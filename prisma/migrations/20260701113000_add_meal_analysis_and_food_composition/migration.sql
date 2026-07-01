-- CreateEnum
CREATE TYPE "MealAnalysisStatus" AS ENUM ('analyzing', 'unconfirmed', 'confirmed', 'analysis_failed');

-- CreateEnum
CREATE TYPE "MealAnalysisCoverage" AS ENUM ('none', 'partial', 'complete');

-- AlterTable
ALTER TABLE "user_daily_records"
ADD COLUMN "meal_analysis_status" "MealAnalysisStatus",
ADD COLUMN "meal_analysis_coverage" "MealAnalysisCoverage",
ADD COLUMN "meal_analysis_updated_at" TIMESTAMPTZ(3),
ADD COLUMN "meal_analysis_failure_reason" TEXT,
ADD COLUMN "meal_source_revision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "food_composition_imports" (
    "id" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "source_version" TEXT,
    "source_file_name" TEXT,
    "source_file_hash" TEXT,
    "source_exported_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'completed',
    "raw_row_count" INTEGER,
    "imported_row_count" INTEGER,
    "rejected_row_count" INTEGER,
    "rejection_summary" JSONB,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_composition_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_composition_categories" (
    "code" TEXT NOT NULL,
    "import_run_id" TEXT,
    "source_row_number" INTEGER,
    "parent_code" TEXT,
    "name" TEXT NOT NULL,
    "level" INTEGER,
    "search_text" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_composition_categories_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "food_composition_items" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "source_row_number" INTEGER,
    "source_serial_number" INTEGER,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "search_text" TEXT,
    "aliases" JSONB,
    "primary_category_code" TEXT,
    "secondary_category_code" TEXT,
    "edible_portion_percent" DOUBLE PRECISION,
    "water_g" DOUBLE PRECISION,
    "energy_kcal" DOUBLE PRECISION,
    "energy_kj" DOUBLE PRECISION,
    "protein_g" DOUBLE PRECISION,
    "fat_g" DOUBLE PRECISION,
    "carbohydrate_g" DOUBLE PRECISION,
    "fiber_g" DOUBLE PRECISION,
    "cholesterol_mg" DOUBLE PRECISION,
    "calcium_mg" DOUBLE PRECISION,
    "phosphorus_mg" DOUBLE PRECISION,
    "potassium_mg" DOUBLE PRECISION,
    "sodium_mg" DOUBLE PRECISION,
    "magnesium_mg" DOUBLE PRECISION,
    "iron_mg" DOUBLE PRECISION,
    "zinc_mg" DOUBLE PRECISION,
    "selenium_mg" DOUBLE PRECISION,
    "copper_mg" DOUBLE PRECISION,
    "manganese_mg" DOUBLE PRECISION,
    "iodine_mg" DOUBLE PRECISION,
    "vitamin_a_mcg_re" DOUBLE PRECISION,
    "thiamin_mg" DOUBLE PRECISION,
    "riboflavin_mg" DOUBLE PRECISION,
    "vitamin_b6_mg" DOUBLE PRECISION,
    "vitamin_b12_mg" DOUBLE PRECISION,
    "folate_ug" DOUBLE PRECISION,
    "niacin_mg" DOUBLE PRECISION,
    "vitamin_c_mg" DOUBLE PRECISION,
    "vitamin_e_mg" DOUBLE PRECISION,
    "carotene_mcg" DOUBLE PRECISION,
    "retinol_mcg" DOUBLE PRECISION,
    "alpha_vitamin_e_mg" DOUBLE PRECISION,
    "extras" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_composition_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_daily_records_user_id_meal_analysis_status_idx" ON "user_daily_records"("user_id", "meal_analysis_status");

-- CreateIndex
CREATE INDEX "user_daily_records_user_id_meal_analysis_updated_at_idx" ON "user_daily_records"("user_id", "meal_analysis_updated_at");

-- CreateIndex
CREATE INDEX "food_composition_imports_source_key_created_at_idx" ON "food_composition_imports"("source_key", "created_at");

-- CreateIndex
CREATE INDEX "food_composition_categories_parent_code_idx" ON "food_composition_categories"("parent_code");

-- CreateIndex
CREATE INDEX "food_composition_categories_name_idx" ON "food_composition_categories"("name");

-- CreateIndex
CREATE INDEX "food_composition_categories_search_text_idx" ON "food_composition_categories"("search_text");

-- CreateIndex
CREATE INDEX "food_composition_items_name_idx" ON "food_composition_items"("name");

-- CreateIndex
CREATE INDEX "food_composition_items_normalized_name_idx" ON "food_composition_items"("normalized_name");

-- CreateIndex
CREATE INDEX "food_composition_items_primary_category_code_idx" ON "food_composition_items"("primary_category_code");

-- CreateIndex
CREATE INDEX "food_composition_items_secondary_category_code_idx" ON "food_composition_items"("secondary_category_code");

-- CreateIndex
CREATE INDEX "food_composition_items_search_text_idx" ON "food_composition_items"("search_text");

-- AddForeignKey
ALTER TABLE "food_composition_categories" ADD CONSTRAINT "food_composition_categories_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "food_composition_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_composition_items" ADD CONSTRAINT "food_composition_items_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "food_composition_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
