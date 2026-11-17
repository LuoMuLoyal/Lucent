-- Align the core users table with the Prisma schema.
ALTER TABLE "users" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "drug_source_imports" (
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
  CONSTRAINT "drug_source_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cn_medicine_products" (
  "id" TEXT NOT NULL,
  "import_run_id" TEXT,
  "source_name" TEXT NOT NULL,
  "source_row_number" INTEGER,
  "name" TEXT NOT NULL,
  "image_url" TEXT,
  "price_text" TEXT,
  "package_spec" TEXT,
  "approval_number" TEXT,
  "manufacturer" TEXT,
  "drug_type" TEXT,
  "main_category" TEXT,
  "subcategory" TEXT,
  "source_url" TEXT,
  "brand_name" TEXT,
  "ingredients" TEXT,
  "properties" TEXT,
  "indications" TEXT,
  "dosage" TEXT,
  "adverse_reactions" TEXT,
  "contraindications" TEXT,
  "precautions" TEXT,
  "pediatric_use" TEXT,
  "geriatric_use" TEXT,
  "pregnancy_lactation" TEXT,
  "pharmacology_toxicology" TEXT,
  "drug_interactions" TEXT,
  "pharmacokinetics" TEXT,
  "overdose" TEXT,
  "storage" TEXT,
  "validity_period" TEXT,
  "barcode" TEXT,
  "national_drug_code" TEXT,
  "search_text" TEXT,
  "extras" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cn_medicine_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "drugbank_drugs" (
  "drugbank_id" TEXT NOT NULL,
  "import_run_id" TEXT,
  "secondary_drugbank_ids" JSONB,
  "drug_type" TEXT,
  "source_created_at" TIMESTAMPTZ(3),
  "source_updated_at" TIMESTAMPTZ(3),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "cas_number" TEXT,
  "unii" TEXT,
  "state" TEXT,
  "groups" JSONB,
  "indication" TEXT,
  "pharmacodynamics" TEXT,
  "mechanism_of_action" TEXT,
  "toxicity" TEXT,
  "metabolism" TEXT,
  "absorption" TEXT,
  "half_life" TEXT,
  "protein_binding" TEXT,
  "route_of_elimination" TEXT,
  "volume_of_distribution" TEXT,
  "clearance" TEXT,
  "classification" JSONB,
  "synonyms" JSONB,
  "products" JSONB,
  "international_brands" JSONB,
  "categories" JSONB,
  "atc_codes" JSONB,
  "food_interactions" JSONB,
  "drug_interactions" JSONB,
  "external_identifiers" JSONB,
  "external_links" JSONB,
  "search_text" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "drugbank_drugs_pkey" PRIMARY KEY ("drugbank_id")
);

CREATE TABLE "drugbank_external_links" (
  "id" TEXT NOT NULL,
  "import_run_id" TEXT,
  "drugbank_id" TEXT NOT NULL,
  "drug_name" TEXT,
  "cas_number" TEXT,
  "drug_type" TEXT,
  "kegg_compound_id" TEXT,
  "kegg_drug_id" TEXT,
  "pubchem_compound_id" TEXT,
  "pubchem_substance_id" TEXT,
  "chebi_id" TEXT,
  "pharmgkb_id" TEXT,
  "het_id" TEXT,
  "uniprot_id" TEXT,
  "uniprot_title" TEXT,
  "genbank_id" TEXT,
  "dpd_id" TEXT,
  "rxlist_link" TEXT,
  "pdrhealth_link" TEXT,
  "wikipedia_id" TEXT,
  "drugs_com_link" TEXT,
  "ndc_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "drugbank_external_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "drugbank_targets" (
  "id" TEXT NOT NULL,
  "import_run_id" TEXT,
  "source_dataset" TEXT NOT NULL,
  "source_target_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "gene_name" TEXT,
  "genbank_protein_id" TEXT,
  "genbank_gene_id" TEXT,
  "uniprot_id" TEXT,
  "uniprot_title" TEXT,
  "pdb_ids" JSONB,
  "gene_card_id" TEXT,
  "gen_atlas_id" TEXT,
  "hgnc_id" TEXT,
  "species" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "drugbank_targets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "drugbank_drug_targets" (
  "id" TEXT NOT NULL,
  "drugbank_id" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "relation_kind" TEXT,
  "actions" JSONB,
  "known_action" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "drugbank_drug_targets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "drug_source_imports_source_key_created_at_idx"
  ON "drug_source_imports"("source_key", "created_at");

CREATE INDEX "cn_medicine_products_name_idx"
  ON "cn_medicine_products"("name");

CREATE INDEX "cn_medicine_products_approval_number_idx"
  ON "cn_medicine_products"("approval_number");

CREATE INDEX "cn_medicine_products_manufacturer_idx"
  ON "cn_medicine_products"("manufacturer");

CREATE INDEX "cn_medicine_products_barcode_idx"
  ON "cn_medicine_products"("barcode");

CREATE INDEX "cn_medicine_products_national_drug_code_idx"
  ON "cn_medicine_products"("national_drug_code");

CREATE INDEX "cn_medicine_products_search_text_idx"
  ON "cn_medicine_products"("search_text");

CREATE INDEX "drugbank_drugs_name_idx"
  ON "drugbank_drugs"("name");

CREATE INDEX "drugbank_drugs_cas_number_idx"
  ON "drugbank_drugs"("cas_number");

CREATE INDEX "drugbank_drugs_unii_idx"
  ON "drugbank_drugs"("unii");

CREATE INDEX "drugbank_drugs_search_text_idx"
  ON "drugbank_drugs"("search_text");

CREATE INDEX "drugbank_external_links_drugbank_id_idx"
  ON "drugbank_external_links"("drugbank_id");

CREATE INDEX "drugbank_external_links_uniprot_id_idx"
  ON "drugbank_external_links"("uniprot_id");

CREATE INDEX "drugbank_external_links_ndc_id_idx"
  ON "drugbank_external_links"("ndc_id");

CREATE INDEX "drugbank_targets_name_idx"
  ON "drugbank_targets"("name");

CREATE INDEX "drugbank_targets_gene_name_idx"
  ON "drugbank_targets"("gene_name");

CREATE INDEX "drugbank_targets_uniprot_id_idx"
  ON "drugbank_targets"("uniprot_id");

CREATE UNIQUE INDEX "drugbank_targets_source_dataset_source_target_id_key"
  ON "drugbank_targets"("source_dataset", "source_target_id");

CREATE INDEX "drugbank_drug_targets_target_id_idx"
  ON "drugbank_drug_targets"("target_id");

CREATE UNIQUE INDEX "drugbank_drug_targets_drugbank_id_target_id_relation_kind_key"
  ON "drugbank_drug_targets"("drugbank_id", "target_id", "relation_kind");

ALTER TABLE "cn_medicine_products"
  ADD CONSTRAINT "cn_medicine_products_import_run_id_fkey"
  FOREIGN KEY ("import_run_id")
  REFERENCES "drug_source_imports"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "drugbank_drugs"
  ADD CONSTRAINT "drugbank_drugs_import_run_id_fkey"
  FOREIGN KEY ("import_run_id")
  REFERENCES "drug_source_imports"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "drugbank_external_links"
  ADD CONSTRAINT "drugbank_external_links_import_run_id_fkey"
  FOREIGN KEY ("import_run_id")
  REFERENCES "drug_source_imports"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "drugbank_external_links"
  ADD CONSTRAINT "drugbank_external_links_drugbank_id_fkey"
  FOREIGN KEY ("drugbank_id")
  REFERENCES "drugbank_drugs"("drugbank_id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "drugbank_targets"
  ADD CONSTRAINT "drugbank_targets_import_run_id_fkey"
  FOREIGN KEY ("import_run_id")
  REFERENCES "drug_source_imports"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "drugbank_drug_targets"
  ADD CONSTRAINT "drugbank_drug_targets_drugbank_id_fkey"
  FOREIGN KEY ("drugbank_id")
  REFERENCES "drugbank_drugs"("drugbank_id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "drugbank_drug_targets"
  ADD CONSTRAINT "drugbank_drug_targets_target_id_fkey"
  FOREIGN KEY ("target_id")
  REFERENCES "drugbank_targets"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
