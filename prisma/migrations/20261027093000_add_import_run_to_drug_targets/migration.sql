-- Add `import_run_id` to `drugbank_drug_targets`.
--
-- Every other DrugBank table records which import run produced its rows, so a
-- failed or partial import can be traced to the rows it wrote (and the run
-- ledger in `drug_source_imports` can be joined). This table was the only one
-- written by the importers without that link, even though two different
-- commands (CSV targets, XML action enrichment) write to it.
--
-- Nullable and ON DELETE SET NULL, matching the rest of the schema: existing
-- rows have no known run, and deleting a ledger row must not delete facts.

ALTER TABLE "drugbank_drug_targets" ADD COLUMN "import_run_id" TEXT;

ALTER TABLE "drugbank_drug_targets"
    ADD CONSTRAINT "drugbank_drug_targets_import_run_id_fkey"
    FOREIGN KEY ("import_run_id") REFERENCES "drug_source_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
