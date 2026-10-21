-- DrugBank patent records: a table (not JSON) because patent-expiry analysis
-- filters and sorts on expiry dates.
CREATE TABLE "drugbank_patents" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "drugbank_id" TEXT NOT NULL,
    "patent_number" TEXT NOT NULL,
    "country" TEXT,
    "approved_on" DATE,
    "expires_on" DATE,
    "pediatric_extension" BOOLEAN,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drugbank_patents_pkey" PRIMARY KEY ("id")
);

-- One row per (drug, property, source): the same property is reported by
-- several sources with different values, and provenance must survive.
CREATE TABLE "drugbank_properties" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "drugbank_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value_text" TEXT NOT NULL,
    "value_num" DOUBLE PRECISION,
    "unit" TEXT,
    "source" TEXT,
    "is_experimental" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drugbank_properties_pkey" PRIMARY KEY ("id")
);

-- 2048-bit Morgan fingerprint as 512 hex chars. Tanimoto is computed in SQL;
-- pgvector distance operators do not express it and the corpus is small.
CREATE TABLE "drugbank_fingerprints" (
    "drugbank_id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "fingerprint" TEXT NOT NULL,
    "bit_count" INTEGER NOT NULL,
    "radius" INTEGER NOT NULL DEFAULT 2,
    "n_bits" INTEGER NOT NULL DEFAULT 2048,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drugbank_fingerprints_pkey" PRIMARY KEY ("drugbank_id")
);

-- Jsonb companion fields on the drug row (PRODUCT §3): pathways, reaction
-- chains and pharmacogenomic variant effects are read as whole blocks.
ALTER TABLE "drugbank_drugs" ADD COLUMN     "pathways" JSONB,
ADD COLUMN     "reactions" JSONB,
ADD COLUMN     "snp_adverse_effects" JSONB,
ADD COLUMN     "snp_effects" JSONB;

CREATE INDEX "drugbank_patents_expires_on_idx" ON "drugbank_patents"("expires_on");
CREATE INDEX "drugbank_patents_drugbank_id_idx" ON "drugbank_patents"("drugbank_id");
CREATE UNIQUE INDEX "drugbank_patents_drugbank_id_patent_number_country_key" ON "drugbank_patents"("drugbank_id", "patent_number", "country");
CREATE INDEX "drugbank_properties_kind_value_num_idx" ON "drugbank_properties"("kind", "value_num");
CREATE INDEX "drugbank_properties_drugbank_id_idx" ON "drugbank_properties"("drugbank_id");
CREATE UNIQUE INDEX "drugbank_properties_drugbank_id_kind_source_key" ON "drugbank_properties"("drugbank_id", "kind", "source");

ALTER TABLE "drugbank_patents" ADD CONSTRAINT "drugbank_patents_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_patents" ADD CONSTRAINT "drugbank_patents_drugbank_id_fkey" FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "drugbank_properties" ADD CONSTRAINT "drugbank_properties_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_properties" ADD CONSTRAINT "drugbank_properties_drugbank_id_fkey" FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "drugbank_fingerprints" ADD CONSTRAINT "drugbank_fingerprints_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_fingerprints" ADD CONSTRAINT "drugbank_fingerprints_drugbank_id_fkey" FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;