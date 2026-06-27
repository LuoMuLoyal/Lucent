-- AlterTable
ALTER TABLE "cn_medicine_leaflets" ADD COLUMN     "dropped_reason" TEXT,
ADD COLUMN     "manufacturer_normalized" TEXT;

-- AlterTable
ALTER TABLE "cn_medicine_product_leaflet_links" ADD COLUMN     "match_type" TEXT;

-- AlterTable
ALTER TABLE "cn_medicine_products" ADD COLUMN     "approval_codes" JSONB,
ADD COLUMN     "best_match_score" INTEGER,
ADD COLUMN     "best_match_type" TEXT,
ADD COLUMN     "candidate_count" INTEGER,
ADD COLUMN     "drugbank_ids" JSONB,
ADD COLUMN     "image_url_cleaned" TEXT,
ADD COLUMN     "manufacturer_normalized" TEXT,
ADD COLUMN     "match_quality_approval" INTEGER,
ADD COLUMN     "match_quality_leaflet" INTEGER,
ADD COLUMN     "match_quality_maker" INTEGER,
ADD COLUMN     "match_quality_name" INTEGER,
ADD COLUMN     "match_quality_notes" JSONB,
ADD COLUMN     "match_quality_overall" INTEGER,
ADD COLUMN     "match_quality_penalty" INTEGER,
ADD COLUMN     "top_candidate_ids" JSONB,
ADD COLUMN     "top_candidate_scores" JSONB;

-- CreateIndex
CREATE INDEX "cn_medicine_products_manufacturer_normalized_idx" ON "cn_medicine_products"("manufacturer_normalized");

-- CreateIndex
CREATE INDEX "cn_medicine_products_best_match_type_idx" ON "cn_medicine_products"("best_match_type");

-- CreateIndex
CREATE INDEX "cn_medicine_products_match_quality_overall_idx" ON "cn_medicine_products"("match_quality_overall");
