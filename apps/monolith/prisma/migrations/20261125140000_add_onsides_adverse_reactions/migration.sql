-- OnSIDES v3.1.1: two tables for structured "ingredient -> adverse reaction" facts.
--
-- Why tables instead of the prose we already hold: `cn_medicine_leaflets.adverse_reactions`
-- is a single String, so it only supports semantic search. It cannot answer "which drugs
-- cause rash", cannot be counted across drugs, and cannot be grouped by label section or
-- filtered by extraction confidence. OnSIDES extracts (label, MedDRA term) pairs from
-- FDA/EMA/EMC/KEGG labels; the import aggregates them up to (ingredient CUI, term), so
-- what lands here is a sparse fact table, not the 6.93M label-level rows.
--
-- No bridging table: the bridge is the existing `drugbank_external_identifiers`
-- (resource = 'RxCUI'). A second mapping table would only add another source of truth.
--
-- Confidence columns: `confidence_max` takes max(pred1), not pred0. In the source, 44.5%
-- of pred0 values are 0 (meaning "no score given") and 36% exceed 1, so it cannot be read
-- as a 0-1 probability. `pred0_max` is kept for provenance only and is nullable, because
-- "unscored" has to stay distinguishable from "scored low".

CREATE TABLE "onsides_adverse_reactions" (
    "id" VARCHAR NOT NULL,
    "meddra_id" VARCHAR NOT NULL,
    "meddra_name" VARCHAR NOT NULL,
    "meddra_term_type" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onsides_adverse_reactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "onsides_adverse_reactions_meddra_id_key"
    ON "onsides_adverse_reactions"("meddra_id");

CREATE TABLE "onsides_ingredient_adverse_effects" (
    "id" VARCHAR NOT NULL,
    "import_run_id" VARCHAR,
    "rxnorm_cui" VARCHAR NOT NULL,
    "reaction_id" VARCHAR NOT NULL,
    "label_count" INTEGER NOT NULL,
    -- The two multi-valued columns are JSONB, not TEXT[], to match every other
    -- array-valued column in this schema: the shared importer binds arrays as JSON
    -- text, and Postgres rejects '["AR"]' as an array literal.
    "label_sections" JSONB NOT NULL DEFAULT '[]'::JSONB,
    "sources" JSONB NOT NULL DEFAULT '[]'::JSONB,
    "confidence_max" DOUBLE PRECISION,
    "pred0_max" DOUBLE PRECISION,
    "source_version" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onsides_ingredient_adverse_effects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "onsides_ingredient_adverse_effects_reaction_id_fkey"
        FOREIGN KEY ("reaction_id") REFERENCES "onsides_adverse_reactions"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "onsides_ingredient_adverse_effects_import_run_id_fkey"
        FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

-- Both directions are query patterns, not optional optimisations: drug -> reactions
-- (detail page) and reaction -> drugs (reverse lookup).
CREATE UNIQUE INDEX "onsides_ingredient_adverse_effects_rxnorm_cui_reaction_id_key"
    ON "onsides_ingredient_adverse_effects"("rxnorm_cui", "reaction_id");

CREATE INDEX "onsides_ingredient_adverse_effects_rxnorm_cui_idx"
    ON "onsides_ingredient_adverse_effects"("rxnorm_cui");

CREATE INDEX "onsides_ingredient_adverse_effects_reaction_id_idx"
    ON "onsides_ingredient_adverse_effects"("reaction_id");