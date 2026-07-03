# Data Sources: DrugBank

本文件是 [[data-sources]] 拆分后的子文档。

相关子文档：

- [[data-sources-cn-products]]
- [[data-sources-medical-qa]]
- [[data-sources-food-composition]]

## DrugBank Source Mapping

Import `unziped/full database.xml` into a raw staging representation first, then normalize selected
fields into `drugbank_drugs`.

- **primary `<drugbank-id>`** → `drugbank_id` — Required stable id, e.g. `DB00001`.
- **non-primary `<drugbank-id>`** → `secondary_drugbank_ids` — String array or JSON.
- **`<drug type="">`** → `drug_type` — DrugBank drug type.
- **`<drug created="">`** → `source_created_at` — Source date.
- **`<drug updated="">`** → `source_updated_at` — Source date.
- **`<name>`** → `name` — Required English display/search name.
- **`<description>`** → `description` — English summary.
- **`<cas-number>`** → `cas_number` — Identifier.
- **`<unii>`** → `unii` — Identifier.
- **`<state>`** → `state` — Physical state.
- **`<groups><group>`** → `groups` — String array or JSON.
- **`<indication>`** → `indication` — Clinical indication text.
- **`<pharmacodynamics>`** → `pharmacodynamics` — Scientific detail.
- **`<mechanism-of-action>`** → `mechanism_of_action` — Scientific detail.
- **`<toxicity>`** → `toxicity` — Scientific detail.
- **`<metabolism>`** → `metabolism` — Scientific detail.
- **`<absorption>`** → `absorption` — Scientific detail.
- **`<half-life>`** → `half_life` — Scientific detail.
- **`<protein-binding>`** → `protein_binding` — Scientific detail.
- **`<route-of-elimination>`** → `route_of_elimination` — Scientific detail.
- **`<volume-of-distribution>`** → `volume_of_distribution` — Scientific detail.
- **`<clearance>`** → `clearance` — Scientific detail.
- **`<classification>`** → `classification` — JSON because the node is hierarchical.
- **`<synonyms>`** → `synonyms` — String array or JSON.
- **`<products>`** → `products` — JSON; not treated as Chinese products.
- **`<international-brands>`** → `international_brands` — JSON/string array.
- **`<categories>`** → `categories` — JSON/string array.
- **`<atc-codes>`** → `atc_codes` — String array or JSON.
- **`<food-interactions>`** → `food_interactions` — JSON/string array.
- **`<drug-interactions>`** → `drug_interactions` — JSON array keyed by interacting DrugBank
  id/name.
- **`<external-identifiers>`** → `external_identifiers` — Also mirror into
  `drugbank_external_links`.
- **`<external-links>`** → `external_links` — Also mirror into `drugbank_external_links`.
- **`<targets>` / `<enzymes>` / `<carriers>` / `<transporters>`** → `relationship tables` — Keep as
  normalized relationship rows or JSON until target APIs need them.

Import `unziped/drug links.csv` into `drugbank_external_links`.

- **`DrugBank ID`** → `drugbank_id` — Foreign key to `drugbank_drugs`.
- **`Name`** → `drug_name` — Redundant source display text.
- **`CAS Number`** → `cas_number` — Can validate/mirror `drugbank_drugs.cas_number`.
- **`Drug Type`** → `drug_type` — Can validate/mirror `drugbank_drugs.drug_type`.
- **`KEGG Compound ID` / `KEGG Drug ID`** → `kegg_compound_id` / `kegg_drug_id` — External ids.
- **`PubChem Compound ID` / `PubChem Substance ID`** → `pubchem_compound_id` /
  `pubchem_substance_id` — External ids.
- **`ChEBI ID`** → `chebi_id` — External id.
- **`PharmGKB ID`** → `pharmgkb_id` — External id.
- **`HET ID`** → `het_id` — External id.
- **`UniProt ID` / `UniProt Title`** → `uniprot_id` / `uniprot_title` — External target/protein
  hint.
- **`GenBank ID`** → `genbank_id` — External id.
- **`DPD ID`** → `dpd_id` — External id.
- **`RxList Link` / `Pdrhealth Link` / `Wikipedia ID` / `Drugs.com Link`** → `link fields` — Keep as
  source references.
- **`NDC ID`** → `ndc_id` — US package/product identifier when present.

Import `unziped/all.csv` or `unziped/pharmacologically_active.csv` into target tables.

- **`ID`** → `source_target_id` — Source row id.
- **`Name`** → `name` — Target display name.
- **`Gene Name`** → `gene_name` — Target gene symbol.
- **`GenBank Protein ID` / `GenBank Gene ID`** → `genbank_protein_id` / `genbank_gene_id` — External
  ids.
- **`UniProt ID` / `Uniprot Title`** → `uniprot_id` / `uniprot_title` — External ids.
- **`PDB ID`** → `pdb_ids` — Split semicolon-delimited values.
- **`GeneCard ID` / `GenAtlas ID` / `HGNC ID`** → `corresponding fields` — External ids.
- **`Species`** → `species` — Target species.
- **`Drug IDs`** → `drugbank_drug_targets.drugbank_id` — Split semicolon-delimited ids into
  relationship rows.
- **`Actions`** → `drugbank_drug_targets.actions` — Split semicolon-delimited action labels when
  present.
- **`Known Action`** → `drugbank_drug_targets.known_action` — Preserve source yes/no or descriptive
  text.

FASTA and SDF files are not needed for Phase 1 search/detail. Keep them outside the database until a
feature requires sequences or structures.

### DrugBank assistant RAG

DrugBank assistant retrieval is separate from the Chinese leaflet corpus and is limited to assistant
usage in this phase.

- source of truth stays `drugbank_drugs` plus related normalized tables
- assistant passages are built only from approved narrative scientific fields such as `description`,
  `indication`, `mechanism_of_action`, `pharmacodynamics`, `toxicity`, `metabolism`, `absorption`,
  `half_life`, and `clearance`
- chunk rows live in `drugbank_passage_chunks`; vector index rows live in
  `drugbank_passage_embeddings`
- retrieval is split into `resolve_drugbank_entity` and `search_drugbank_passages`
- passage search is entity-scoped rather than open-ended whole-corpus search

Rebuild pipeline (smoke-test with 100 drugs and 100 chunks):

```bash
pnpm exec ts-node scripts/import/medicine/import-medicine-knowledge.ts drugbank-drugs --limit 100
pnpm exec ts-node scripts/import/medicine/rebuild-drugbank-rag-index.ts \
  --limit 100 --embed --embed-limit 100 --embed-batch-size 10
```
