-- Align CN medicine schema with V3 (DrugEntityDedup) data model.
--
-- Uses conditional drops (DO $$ … EXCEPTION) because some columns were
-- already removed in earlier migrations (e.g. 20260703065114).
-- V3 data carries pregnancy_lactation/pediatric_use/geriatric_use on
-- leaflets — those columns were dropped in 20260703065114 and must be
-- re-added here.

-- ── cn_medicine_products: body-text columns ──────────────────────
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "ingredients";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "properties";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "indications";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "dosage";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "adverse_reactions";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "contraindications";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "precautions";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "pharmacology_toxicology";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "drug_interactions";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "pharmacokinetics";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "storage";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "validity_period";
EXCEPTION WHEN undefined_column THEN NULL; END $$;

-- Products: match-internal + obsolete columns
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "drugbank_ids";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "best_match_type";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "best_match_score";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "top_candidate_ids";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "top_candidate_scores";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "candidate_count";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "match_quality_overall";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "match_quality_approval";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "match_quality_name";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "match_quality_maker";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "match_quality_leaflet";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "match_quality_penalty";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "match_quality_notes";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" DROP COLUMN "image_url_cleaned";
EXCEPTION WHEN undefined_column THEN NULL; END $$;

-- Products: rename
DO $$ BEGIN
  ALTER TABLE "cn_medicine_products" RENAME COLUMN "manufacturer_normalized" TO "manufacturer_clean";
EXCEPTION WHEN undefined_column THEN NULL; END $$;

-- ── cn_medicine_leaflets: drop V2-only columns ───────────────────
DO $$ BEGIN
  ALTER TABLE "cn_medicine_leaflets" DROP COLUMN "source_file";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_leaflets" DROP COLUMN "title";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_leaflets" DROP COLUMN "number_raw";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_leaflets" DROP COLUMN "summary";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_leaflets" DROP COLUMN "pinyin";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_leaflets" DROP COLUMN "approval_conflict";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_leaflets" DROP COLUMN "merge_notes";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_leaflets" DROP COLUMN "dropped_reason";
EXCEPTION WHEN undefined_column THEN NULL; END $$;

-- Leaflets: rename to V3 names
DO $$ BEGIN
  ALTER TABLE "cn_medicine_leaflets" RENAME COLUMN "title_url" TO "source_url";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_leaflets" RENAME COLUMN "approval_raw" TO "approval_text";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_leaflets" RENAME COLUMN "drug_category" TO "category";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_leaflets" RENAME COLUMN "drug_nature" TO "regulatory_class";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_leaflets" RENAME COLUMN "properties" TO "appearance";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_leaflets" RENAME COLUMN "manufacturer_normalized" TO "manufacturer_clean";
EXCEPTION WHEN undefined_column THEN NULL; END $$;

-- Leaflets: re-add columns that V3 data carries but were dropped in 20260703065114
DO $$ BEGIN
  ALTER TABLE "cn_medicine_leaflets" ADD COLUMN "pregnancy_lactation" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_leaflets" ADD COLUMN "pediatric_use" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cn_medicine_leaflets" ADD COLUMN "geriatric_use" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ── cn_medicine_product_leaflet_links ────────────────────────────
DO $$ BEGIN
  ALTER TABLE "cn_medicine_product_leaflet_links" DROP COLUMN "approval_code";
EXCEPTION WHEN undefined_column THEN NULL; END $$;
ALTER TABLE "cn_medicine_product_leaflet_links" ADD COLUMN "match_key" TEXT;

-- Drop indexes on removed columns (safe to run multiple times)
DROP INDEX IF EXISTS "cn_medicine_products_best_match_type_idx";
DROP INDEX IF EXISTS "cn_medicine_products_match_quality_overall_idx";
DROP INDEX IF EXISTS "cn_medicine_products_manufacturer_normalized_idx";
DROP INDEX IF EXISTS "cn_medicine_product_leaflet_links_approval_code_idx";
