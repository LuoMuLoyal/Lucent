-- AlterTable
ALTER TABLE "data_export_requests" ALTER COLUMN "kind" DROP DEFAULT,
ALTER COLUMN "format" DROP DEFAULT,
ALTER COLUMN "range" DROP DEFAULT;

-- CreateTable
CREATE TABLE "cn_medicine_leaflets" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "instruction_id" TEXT NOT NULL,
    "source_file" TEXT,
    "source_row" INTEGER,
    "title" TEXT,
    "title_url" TEXT,
    "number_raw" TEXT,
    "summary" TEXT,
    "generic_name" TEXT,
    "brand_name" TEXT,
    "pinyin" TEXT,
    "approval_raw" TEXT,
    "approval_codes" JSONB,
    "approval_conflict" TEXT,
    "drug_category" TEXT,
    "manufacturer" TEXT,
    "drug_nature" TEXT,
    "related_diseases" TEXT,
    "properties" TEXT,
    "ingredients" TEXT,
    "indications" TEXT,
    "package_spec" TEXT,
    "adverse_reactions" TEXT,
    "dosage" TEXT,
    "contraindications" TEXT,
    "precautions" TEXT,
    "pregnancy_lactation" TEXT,
    "pediatric_use" TEXT,
    "geriatric_use" TEXT,
    "drug_interactions" TEXT,
    "pharmacology_toxicology" TEXT,
    "pharmacokinetics" TEXT,
    "storage" TEXT,
    "validity_period" TEXT,
    "merge_notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cn_medicine_leaflets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cn_medicine_product_leaflet_links" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "product_id" TEXT NOT NULL,
    "leaflet_id" TEXT NOT NULL,
    "approval_code" TEXT,
    "match_score" INTEGER,
    "is_best_match" BOOLEAN,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cn_medicine_product_leaflet_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicine_leaflet_chunks" (
    "id" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL,
    "leaflet_id" TEXT NOT NULL,
    "source_field" TEXT NOT NULL,
    "chunk_text" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "token_count" INTEGER,
    "source_version" TEXT,
    "source_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medicine_leaflet_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cn_medicine_leaflets_instruction_id_key" ON "cn_medicine_leaflets"("instruction_id");

-- CreateIndex
CREATE INDEX "cn_medicine_leaflets_generic_name_idx" ON "cn_medicine_leaflets"("generic_name");

-- CreateIndex
CREATE INDEX "cn_medicine_leaflets_manufacturer_idx" ON "cn_medicine_leaflets"("manufacturer");

-- CreateIndex
CREATE INDEX "cn_medicine_leaflets_approval_codes_idx" ON "cn_medicine_leaflets"("approval_codes");

-- CreateIndex
CREATE INDEX "cn_medicine_product_leaflet_links_product_id_idx" ON "cn_medicine_product_leaflet_links"("product_id");

-- CreateIndex
CREATE INDEX "cn_medicine_product_leaflet_links_leaflet_id_idx" ON "cn_medicine_product_leaflet_links"("leaflet_id");

-- CreateIndex
CREATE INDEX "cn_medicine_product_leaflet_links_approval_code_idx" ON "cn_medicine_product_leaflet_links"("approval_code");

-- CreateIndex
CREATE UNIQUE INDEX "cn_medicine_product_leaflet_links_product_id_leaflet_id_key" ON "cn_medicine_product_leaflet_links"("product_id", "leaflet_id");

-- CreateIndex
CREATE INDEX "medicine_leaflet_chunks_leaflet_id_idx" ON "medicine_leaflet_chunks"("leaflet_id");

-- CreateIndex
CREATE INDEX "medicine_leaflet_chunks_source_field_idx" ON "medicine_leaflet_chunks"("source_field");

-- CreateIndex
CREATE UNIQUE INDEX "medicine_leaflet_chunks_leaflet_id_source_field_chunk_index_key" ON "medicine_leaflet_chunks"("leaflet_id", "source_field", "chunk_index");

-- AddForeignKey
ALTER TABLE "cn_medicine_leaflets" ADD CONSTRAINT "cn_medicine_leaflets_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cn_medicine_product_leaflet_links" ADD CONSTRAINT "cn_medicine_product_leaflet_links_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cn_medicine_product_leaflet_links" ADD CONSTRAINT "cn_medicine_product_leaflet_links_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "cn_medicine_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cn_medicine_product_leaflet_links" ADD CONSTRAINT "cn_medicine_product_leaflet_links_leaflet_id_fkey" FOREIGN KEY ("leaflet_id") REFERENCES "cn_medicine_leaflets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicine_leaflet_chunks" ADD CONSTRAINT "medicine_leaflet_chunks_leaflet_id_fkey" FOREIGN KEY ("leaflet_id") REFERENCES "cn_medicine_leaflets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
