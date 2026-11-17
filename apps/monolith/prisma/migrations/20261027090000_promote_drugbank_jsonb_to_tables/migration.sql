-- Promote DrugBank's multi-valued JsonB fields to relation tables.
--
-- The criterion is the *query shape*, not the data shape: a field becomes a
-- table only when something needs a reverse lookup ("which drugs interact with
-- X") or an inner-field filter ("which drugs are withdrawn"). Sizes in the
-- section headers are measured over the 19,842-drug corpus.
--
-- The superseded JsonB columns are dropped in this same migration: leaving them
-- would create a second source of truth that the rewritten importer never
-- updates again, i.e. silent staleness.

-- ── 1. Drug-drug interaction (4,631 drugs / 2.9M rows) ────────────────────
CREATE TABLE "drugbank_drug_interactions" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "drugbank_id" TEXT NOT NULL,
    "interacts_with_id" TEXT NOT NULL,
    "interacts_with_name" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drugbank_drug_interactions_pkey" PRIMARY KEY ("id")
);

-- The partner drug may be absent from drugbank_drugs (withdrawn products,
-- entities from other sources), so there is deliberately no foreign key here.
CREATE UNIQUE INDEX "drugbank_drug_interactions_drugbank_id_interacts_with_id_key"
    ON "drugbank_drug_interactions"("drugbank_id", "interacts_with_id");
CREATE INDEX "drugbank_drug_interactions_interacts_with_id_idx"
    ON "drugbank_drug_interactions"("interacts_with_id");

-- ── 2. Product / label information (4,465 drugs / 474k rows) ──────────────
CREATE TABLE "drugbank_products" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "drugbank_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "labeller" TEXT,
    "ndc_id" TEXT,
    "ndc_product_code" TEXT,
    "dpd_id" TEXT,
    "ema_product_code" TEXT,
    "ema_ma_number" TEXT,
    "dosage_form" TEXT,
    "strength" TEXT,
    "route" TEXT,
    "fda_application_number" TEXT,
    "generic" BOOLEAN,
    "over_the_counter" BOOLEAN,
    "approved" BOOLEAN,
    "country" TEXT,
    "started_marketing_on" DATE,
    "ended_marketing_on" DATE,
    "source" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drugbank_products_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "drugbank_products_drugbank_id_idx" ON "drugbank_products"("drugbank_id");
CREATE INDEX "drugbank_products_name_idx" ON "drugbank_products"("name");
CREATE INDEX "drugbank_products_ndc_product_code_idx" ON "drugbank_products"("ndc_product_code");
CREATE INDEX "drugbank_products_labeller_idx" ON "drugbank_products"("labeller");
-- Withdrawal screening filters on the marketing end date.
CREATE INDEX "drugbank_products_ended_marketing_on_idx" ON "drugbank_products"("ended_marketing_on");

-- ── 3. Synonyms (18,160 drugs / 42,961 rows, 91.5%) ──────────────────────
CREATE TABLE "drugbank_synonyms" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "drugbank_id" TEXT NOT NULL,
    "synonym" TEXT NOT NULL,
    "language" TEXT,
    "coder" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drugbank_synonyms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "drugbank_synonyms_drugbank_id_synonym_key"
    ON "drugbank_synonyms"("drugbank_id", "synonym");
-- Synonym search; pg_trgm is already installed in this database (1.6).
CREATE INDEX "drugbank_synonyms_synonym_idx" ON "drugbank_synonyms"("synonym");

-- ── 4. Manufacturers (829 drugs / 5,669 rows) ────────────────────────────
CREATE TABLE "drugbank_manufacturers" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "drugbank_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "generic" BOOLEAN,
    "url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drugbank_manufacturers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "drugbank_manufacturers_drugbank_id_name_key"
    ON "drugbank_manufacturers"("drugbank_id", "name");
CREATE INDEX "drugbank_manufacturers_name_idx" ON "drugbank_manufacturers"("name");

-- ── 5. Packagers (1,215 drugs / 20,355 rows) ─────────────────────────────
CREATE TABLE "drugbank_packagers" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "drugbank_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drugbank_packagers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "drugbank_packagers_drugbank_id_name_key"
    ON "drugbank_packagers"("drugbank_id", "name");
CREATE INDEX "drugbank_packagers_name_idx" ON "drugbank_packagers"("name");

-- ── 6. Dosage form / route / strength (5,276 drugs / 100,085 rows) ───────
CREATE TABLE "drugbank_dosages" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "drugbank_id" TEXT NOT NULL,
    "form" TEXT,
    "route" TEXT,
    "strength" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drugbank_dosages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "drugbank_dosages_drugbank_id_form_route_strength_key"
    ON "drugbank_dosages"("drugbank_id", "form", "route", "strength");
CREATE INDEX "drugbank_dosages_form_idx" ON "drugbank_dosages"("form");
CREATE INDEX "drugbank_dosages_route_idx" ON "drugbank_dosages"("route");

-- ── 7. External identifiers (17,309 drugs / 93,636 rows) ─────────────────
CREATE TABLE "drugbank_external_identifiers" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "drugbank_id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drugbank_external_identifiers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "drugbank_external_identifiers_drugbank_id_resource_identifier_key"
    ON "drugbank_external_identifiers"("drugbank_id", "resource", "identifier");
-- Reverse lookup: a user holding a ChEBI or PubChem id finding the drug.
CREATE INDEX "drugbank_external_identifiers_resource_identifier_idx"
    ON "drugbank_external_identifiers"("resource", "identifier");

-- ── 8. Chemical classification path (11,195 drugs, one row each) ─────────
CREATE TABLE "drugbank_classifications" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "drugbank_id" TEXT NOT NULL,
    "kingdom" TEXT,
    "superclass" TEXT,
    "class" TEXT,
    "subclass" TEXT,
    "direct_parent" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drugbank_classifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "drugbank_classifications_drugbank_id_key"
    ON "drugbank_classifications"("drugbank_id");
CREATE INDEX "drugbank_classifications_kingdom_idx" ON "drugbank_classifications"("kingdom");
CREATE INDEX "drugbank_classifications_superclass_idx" ON "drugbank_classifications"("superclass");
CREATE INDEX "drugbank_classifications_class_idx" ON "drugbank_classifications"("class");
CREATE INDEX "drugbank_classifications_subclass_idx" ON "drugbank_classifications"("subclass");

-- ── 9. Approval group membership (all 19,842 drugs / 7,466 rows) ─────────
CREATE TABLE "drugbank_groups" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT,
    "drugbank_id" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drugbank_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "drugbank_groups_drugbank_id_group_name_key"
    ON "drugbank_groups"("drugbank_id", "group_name");
CREATE INDEX "drugbank_groups_group_name_idx" ON "drugbank_groups"("group_name");

-- ── 10. Foreign keys (all ON DELETE CASCADE: rows die with their drug) ───
ALTER TABLE "drugbank_drug_interactions"
    ADD CONSTRAINT "drugbank_drug_interactions_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_drug_interactions"
    ADD CONSTRAINT "drugbank_drug_interactions_drugbank_id_fkey"
    FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "drugbank_products"
    ADD CONSTRAINT "drugbank_products_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_products"
    ADD CONSTRAINT "drugbank_products_drugbank_id_fkey"
    FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "drugbank_synonyms"
    ADD CONSTRAINT "drugbank_synonyms_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_synonyms"
    ADD CONSTRAINT "drugbank_synonyms_drugbank_id_fkey"
    FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "drugbank_manufacturers"
    ADD CONSTRAINT "drugbank_manufacturers_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_manufacturers"
    ADD CONSTRAINT "drugbank_manufacturers_drugbank_id_fkey"
    FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "drugbank_packagers"
    ADD CONSTRAINT "drugbank_packagers_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_packagers"
    ADD CONSTRAINT "drugbank_packagers_drugbank_id_fkey"
    FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "drugbank_dosages"
    ADD CONSTRAINT "drugbank_dosages_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_dosages"
    ADD CONSTRAINT "drugbank_dosages_drugbank_id_fkey"
    FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "drugbank_external_identifiers"
    ADD CONSTRAINT "drugbank_external_identifiers_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_external_identifiers"
    ADD CONSTRAINT "drugbank_external_identifiers_drugbank_id_fkey"
    FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "drugbank_classifications"
    ADD CONSTRAINT "drugbank_classifications_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_classifications"
    ADD CONSTRAINT "drugbank_classifications_drugbank_id_fkey"
    FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "drugbank_groups"
    ADD CONSTRAINT "drugbank_groups_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drugbank_groups"
    ADD CONSTRAINT "drugbank_groups_drugbank_id_fkey"
    FOREIGN KEY ("drugbank_id") REFERENCES "drugbank_drugs"("drugbank_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 11. Drop the superseded JsonB columns ────────────────────────────────
-- Their data is rebuilt into the tables above by the rewritten importers;
-- keeping them would leave a second source of truth that never updates again.
ALTER TABLE "drugbank_drugs" DROP COLUMN IF EXISTS "groups";
ALTER TABLE "drugbank_drugs" DROP COLUMN IF EXISTS "classification";
ALTER TABLE "drugbank_drugs" DROP COLUMN IF EXISTS "synonyms";
ALTER TABLE "drugbank_drugs" DROP COLUMN IF EXISTS "products";
ALTER TABLE "drugbank_drugs" DROP COLUMN IF EXISTS "drug_interactions";
ALTER TABLE "drugbank_drugs" DROP COLUMN IF EXISTS "external_identifiers";
