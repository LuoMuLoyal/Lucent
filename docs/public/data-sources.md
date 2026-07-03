# Data Sources

Last updated: 2026-07-03

## Target Directory

Local external data directory:

```text
D:\25080\Documents\VSCodeProject\Lumos\DrugDataBase
```

This directory is not tracked by Git and must not be packaged into Flutter.

## Current Sources

- `FullDrugDetail.xlsx`: raw Chinese medicine product catalog (product metadata, sparse instruction fields).
- `药品说明书数据库_医药数据查询/`: raw scraped Chinese medicine leaflets from yaozs.com (rich instruction text, sparse product metadata).
- `ChineseDrugData_Master_V2/ChineseDrugData_Master_V2.xlsx`: **recommended CN source for Lucent as of 4.0.0**. Built by `DrugDataBase/ChineseDrugData_Master_V2/build_master_v2.py` from the two sources above. Each product row links to the best matched instruction via `best_instruction_id`; instruction text is no longer flattened into the product row. V1 (`ChineseDrugData_Master.xlsx`) is kept as an archived reference and should not be used for new imports.
- DrugBank files: English scientific enrichment source, including XML, CSV, FASTA, and SDF assets.

## Practical Import Workflow

1. Build the CN master file first:
   ```powershell
   cd ..\DrugDataBase
   .venv\Scripts\python ChineseDrugData_Master_V2\build_master_v2.py
   # or on msys bash: .venv/bin/python ChineseDrugData_Master_V2/build_master_v2.py
   ```
   This produces `ChineseDrugData_Master_V2/ChineseDrugData_Master_V2.xlsx`, which is the preferred source for `cn-products` import. The V1 `build_cn_master.py` output is archived and no longer used.
2. `ChineseDrugData_Master_V2/ChineseDrugData_Master_V2.xlsx` can be imported with GUI tools such as DBeaver for quick raw/staging load or spot-check import. V1 (`ChineseDrugData_Master.xlsx`) is archived and should not be used for new imports.
3. `drug links.csv`, `all.csv`, and `pharmacologically_active.csv` can also be handled by DBeaver or regular PostgreSQL CSV import flows.
4. `full database.xml` should not be treated as a manual GUI import. It is about 1.9 GB after unzip and should be parsed by an idempotent script into normalized tables.
5. Do not convert `full database.xml` to `xlsx` as a normal workflow. `xlsx` adds a row/column flattening step, size overhead, Excel/DBeaver cell limits, and loses the benefit of streaming the XML incrementally.
6. Lucent now has durable destination tables for both sources. Tool-based import is acceptable for the Chinese master source, but the DrugBank XML path should stay scripted so we can reproduce it.

## Scripted Import Commands

Recommended local preparation:

1. Build `ChineseDrugData_Master_V2/ChineseDrugData_Master_V2.xlsx` (see [CN Master Build](#cn-master-build)).
2. `pnpm dev:stack`
3. `pnpm db:migrate`
4. `pip install -r scripts/import/medicine/requirements.txt` if the Chinese master source is still `.xlsx`

Default scripted import order:

```bash
pnpm import:medicine:all
```

This runs:

1. `drugbank-drugs`
2. `drugbank-links`
3. `drugbank-targets-all`
4. `drugbank-targets-active`
5. `cn-leaflets`
6. `cn-products`
7. `cn-product-leaflet-links`

Why this order:

- `drugbank_external_links` depends on `drugbank_drugs.drugbank_id`.
- `drugbank_drug_targets` depends on both imported DrugBank drugs and imported target rows.
- `cn_medicine_product_leaflet_links` depends on both `cn_medicine_products` and `cn_medicine_leaflets`, so it runs last.

Chinese source notes:

- The default source for all CN commands is `../DrugDataBase/ChineseDrugData_Master_V2/ChineseDrugData_Master_V2.xlsx`.
- `cn-products` reads sheet `ProductsEnriched`.
- `cn-leaflets` reads sheet `InstructionsClean`.
- `cn-product-leaflet-links` reads both `ProductsEnriched` (for product id mapping and best-match metadata) and `ProductInstructionLinks` (exact-code candidates), then guarantees a best-match link for every product regardless of whether it was matched by `exact_code` or `fuzzy_name`.
- If you need to override, pass `--source <path>` to the import command.

Smoke-test example:

```powershell
node scripts/import/medicine/import-medicine-datasets.ts --limit 20 --with-hash
```

Useful options:

- `-Command cn-products` or `-Command drugbank-drugs` to run one dataset only.
- `-SourcePath <file>` to override the default file for a single dataset import (for `cn-products`, this overrides `ChineseDrugData_Master_V2/ChineseDrugData_Master_V2.xlsx`).
- `-NodeEnv test` to target the test database intentionally.
- `-BatchSize 250` to tune upsert batch size.
- `-SourceVersion 2026-05-30` to persist the export/version string into `drug_source_imports.source_version`.
- `-WithHash` to store a SHA-256 file hash in `drug_source_imports.source_file_hash`.

Import batches are deduplicated by the target table conflict key before upsert. This keeps smoke and full imports idempotent when a source file emits multiple rows for the same durable record, such as repeated DrugBank primary ids in the XML stream.

Chinese source note:

- `scripts/import/medicine/parsers/cn_products.py` supports both `.xlsx` and `.csv`.
- If `openpyxl` is not available, export `FullDrugDetail.xlsx` sheet `总的` to CSV and pass `--source` / `-Command cn-products` with that CSV path.

## Medicine Data Strategy

Lucent keeps the Chinese and English medicine datasets separate at query time. The two sources describe different things:

- English source (DrugBank XML/CSV): scientific drug entities, identifiers, mechanisms, pharmacology, targets, and interactions. This is the default medicine knowledge source for the personal health copilot.
- Chinese source (`ChineseDrugData_Master_V2/ChineseDrugData_Master_V2.xlsx`): Chinese market medicine products linked to package insert text, with quality scores and candidate metadata. This is the locked regional execution source for Chinese product/package lookup and CN leaflet RAG in 4.0.0.

Do not force both sources into one canonical medicine table in Phase 1. Matching Chinese products to DrugBank drug entities is a later enrichment task because one Chinese product can map to multiple active ingredients, and one DrugBank drug can map to many brands/products.

Assistant tooling now also reflects this separation:

- `search_cn_medicine_products`
- `get_cn_medicine_detail`
- `get_drugbank_detail`

The two datasets do not have the same field model. Lucent should handle this with two layers:

1. A small common response layer for search lists and generic detail headers.
2. A source-specific detail payload that preserves each dataset's native fields.

Do not invent empty columns just to make `cn_medicine_products` and `drugbank_drugs` look identical. Missing or irrelevant source fields should stay absent from the source-specific payload.

Recommended durable tables after staging:

| Table                               | Purpose                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `cn_medicine_products`              | One row per Chinese product/specification from `ChineseDrugData_Master_V2.xlsx`.                                    |
| `cn_medicine_leaflets`              | One row per cleaned yaozs instruction from `ChineseDrugData_Master_V2.xlsx`.                                        |
| `cn_medicine_product_leaflet_links` | Product-to-leaflet links with match type, approval code, and match score from `ChineseDrugData_Master_V2.xlsx`.     |
| `medicine_leaflet_chunks`           | Chunked leaflet text for RAG; empty until the rebuild-leaflet-index pipeline runs.                                  |
| `drugbank_drugs`                    | One row per primary DrugBank drug entry from `full database.xml`.                                                   |
| `drugbank_external_links`           | External identifiers and consumer links from `drug links.csv` plus XML external identifiers/links.                  |
| `drugbank_targets`                  | Target/polypeptide rows from `all.csv` or `pharmacologically_active.csv`.                                           |
| `drugbank_drug_targets`             | Many-to-many relationship between DrugBank drugs and target rows.                                                   |
| `drugbank_passage_chunks`           | Chunked narrative passages from `drugbank_drugs` for RAG; empty until the rebuild-drugbank-rag-index pipeline runs. |
| `medical_qa_chunks`                 | Filtered question/answer pairs from the medical QA corpus for assistant-only RAG.                                   |
| `drug_source_imports`               | Import run metadata: source name, version/export date, file hash, row counts, rejection summary.                    |

These durable tables now exist in Lucent's Prisma schema and migration history. Local development currently holds 100-record smoke-test subsets for DrugBank drugs, DrugBank passage chunks, and medical QA chunks; full imports remain optional and are run with the same scripts using higher or omitted `--limit` values.

Optional later table:

| Table                     | Purpose                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `medicine_source_matches` | Reviewed mapping between `cn_medicine_products` and `drugbank_drugs`, with match method and confidence. |

## RAG Knowledge Sources

Assistant retrieval keeps each corpus separate. Lucent does not merge Chinese leaflet, DrugBank scientific passages, and medical QA into one embedding table or one generic search tool.

Assistant structured medicine lookup is also source-owned rather than merged:

- Chinese structured product search/detail stays on `cn_medicine_products`
- DrugBank structured detail stays on `drugbank_drugs`
- Cross-source matching still requires a future reviewed bridge instead of runtime guessing

### Chinese leaflet RAG

Chinese leaflet RAG uses chunked package-insert text from `cn_medicine_leaflets`.

- chunk rows live in `medicine_leaflet_chunks`
- vector index rows live in a dedicated PGVector-backed leaflet store
- retrieval is exposed through `search_medicine_leaflets`
- `search_medicine_leaflets` resolves the product by aggregating vector chunk scores over the leaflet store before returning chunks

Rebuild pipeline:

```bash
pnpm exec ts-node scripts/import/medicine/rebuild-leaflet-index.ts --embed --embed-limit 100
```

The retrieval path stays product-scoped and vector-first. A retrieval miss does not fall back to keyword guessing.

### DrugBank assistant RAG

DrugBank assistant retrieval is separate from the Chinese leaflet corpus and is limited to assistant usage in this phase.

- source of truth stays `drugbank_drugs` plus related normalized tables
- assistant passages are built only from approved narrative scientific fields such as `description`, `indication`, `mechanism_of_action`, `pharmacodynamics`, `toxicity`, `metabolism`, `absorption`, `half_life`, and `clearance`
- chunk rows live in `drugbank_passage_chunks`; vector index rows live in `drugbank_passage_embeddings`
- retrieval is split into `resolve_drugbank_entity` and `search_drugbank_passages`
- passage search is entity-scoped rather than open-ended whole-corpus search

Rebuild pipeline (smoke-test with 100 drugs and 100 chunks):

```bash
pnpm exec ts-node scripts/import/medicine/import-medicine-knowledge.ts drugbank-drugs --limit 100
pnpm exec ts-node scripts/import/medicine/rebuild-drugbank-rag-index.ts --limit 100 --embed --embed-limit 100 --embed-batch-size 10
```

### Assistant-only medical QA corpus: 医疗问答数据集

- **Location:** `DrugDataBase/医疗问答数据集一共135万条/数据集/alpaca_zh_demo.json`
- **Size:** ~1.83 GB, ~1.36 million records
- **Format:** JSON array of Alpaca-style objects: `{ "id": "DX_N", "instruction": "问题", "output": "回答" }`
- **Status:** assistant-only reference corpus candidate; import/indexing stays separate from leaflet and DrugBank stores and must preserve explicit safety filtering and disclaimer behavior.
- **Import script:** `scripts/import/medicine/import-medical-qa.ts` streams the NDJSON source, applies a safety filter, writes `medical_qa_chunks`, and optionally embeds into `medical_qa_embeddings`.

Smoke-test command (100 records, 100 chunks):

```bash
pnpm exec ts-node scripts/import/medicine/import-medical-qa.ts --filter --limit 100
pnpm exec ts-node scripts/import/medicine/import-medical-qa.ts --embed --embed-limit 100 --embed-batch-size 10
```

Why it is different from leaflet and DrugBank RAG:

- Leaflets are official package inserts tied to a product; the Q&A set is generic medical question/answer content of unknown provenance.
- The retrieval path is open-domain and lower-trust, so it must remain a separate assistant-only semantic retrieval path (e.g., `medical_qa_chunks` + dedicated vector store).
- Many answers contain diagnosis and treatment recommendations. Using them verbatim would cross the project's medical red line.

**Boundaries if integrated in the future:**

1. **Scope restriction:** only use it for general health education, symptom explanations, and "when to see a doctor" guidance. Exclude diagnosis, prescription, dosage, and treatment plans.
2. **Content filtering:** pre-filter or tag records; drop or block high-risk categories.
3. **Disclaimer:** every answer sourced from this dataset must be labeled as reference-only and not a substitute for professional medical advice.
4. **Human review:** treat the dataset as unverified; do not present it as authoritative.
5. **Separate storage:** do not mix Q&A chunks with leaflet chunks or DrugBank passages; keep distinct storage, metadata, and retrieval logic.
6. **Legal/compliance review:** confirm with legal/product before enabling user-facing retrieval.

The frontend linear medication suggestion/risk flow must not consume this QA corpus in the current phase.

As of 4.0.0, `ChineseDrugData_Master_V2/ChineseDrugData_Master_V2.xlsx` is the locked CN source for both structured product lookup and leaflet RAG. The data fusion pipeline is frozen for 4.0.0; further improvements (DrugBank bridging, product aggregation, English translation) are scheduled for 4.x.

Current bridge status (verified 2026-07-02 on the local V2 workbook snapshot):

- `ProductsEnriched` currently contains a `drugbank_ids` column, but the reviewed local snapshot has **0 populated rows** in that column.
- Do not treat `drugbank_ids` as an already solved CN -> DrugBank bridge in runtime logic.
- Any future cross-source bridge needs a new reviewed mapping pipeline, likely starting from normalized ingredient extraction rather than assuming product-name-level exact joins.

## Chinese Source Mapping

Import `ChineseDrugData_Master_V2/ChineseDrugData_Master_V2.xlsx` sheets into Lucent-owned durable tables:

- `ProductsEnriched` -> `cn_medicine_products`
- `InstructionsClean` -> `cn_medicine_leaflets`
- `ProductInstructionLinks` -> `cn_medicine_product_leaflet_links`

These sheets are produced by `DrugDataBase/ChineseDrugData_Master_V2/build_master_v2.py`, which merges:

- `FullDrugDetail.xlsx` product catalog fields.
- The cleaned instruction rows from `药品说明书数据库_医药数据查询/` (yaozs.com leaflets).

Product-level fields come from `FullDrugDetail.xlsx`; canonical instruction text comes from the cleaned yaozs rows. When no instruction matches a product, the product row still exists in `cn_medicine_products`, but it will have no linked rows in `cn_medicine_product_leaflet_links`.

| XLSX column               | `cn_medicine_products` field | Notes                                                                               |
| ------------------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| `product_name`            | `name`                       | Required search/display name. Keep the original text.                               |
| `image_url`               | `image_url`                  | Keep source URL; proxy/cache decision remains separate.                             |
| `price`                   | `price_text`                 | Keep as text because values may be empty or non-normalized.                         |
| `package_spec`            | `package_spec`               | Product-specific strength/package text.                                             |
| `approval_number`         | `approval_number`            | Chinese approval number; useful for dedupe and detail display.                      |
| `manufacturer`            | `manufacturer`               | Manufacturer display/filter field.                                                  |
| `drug_type`               | `drug_type`                  | Example: prescription / OTC text.                                                   |
| `main_category`           | `main_category`              | Broad category.                                                                     |
| `subcategory`             | `subcategory`                | Secondary category.                                                                 |
| `detail_url`              | `source_url`                 | Original detail page.                                                               |
| `brand_name`              | `brand_name`                 | Optional brand/trade name.                                                          |
| `ingredients`             | `ingredients`                | Package insert field.                                                               |
| `properties`              | `properties`                 | Package insert field.                                                               |
| `indications`             | `indications`                | Package insert field.                                                               |
| `dosage`                  | `dosage`                     | Package insert field.                                                               |
| `adverse_reactions`       | `adverse_reactions`          | Package insert field.                                                               |
| `contraindications`       | `contraindications`          | Package insert field.                                                               |
| `precautions`             | `precautions`                | Package insert field.                                                               |
| `pediatric_use`           | `pediatric_use`              | Package insert field.                                                               |
| `geriatric_use`           | `geriatric_use`              | Package insert field.                                                               |
| `pregnancy_lactation`     | `pregnancy` + `lactation`    | Package insert field; API splits sentences by context keywords into two DTO fields. |
| `pharmacology_toxicology` | `pharmacology_toxicology`    | Package insert field.                                                               |
| `drug_interactions`       | `drug_interactions`          | Package insert field.                                                               |
| `pharmacokinetics`        | `pharmacokinetics`           | Package insert field.                                                               |
| `overdose`                | `overdose`                   | Kept from `FullDrugDetail`; yaozs source does not provide this field.               |
| `storage`                 | `storage`                    | Enriched from matched yaozs instruction when available.                             |
| `validity_period`         | `validity_period`            | Enriched from matched yaozs instruction when available.                             |
| `barcode`                 | `barcode`                    | Product barcode when present.                                                       |
| `national_drug_code`      | `national_drug_code`         | National drug code when present.                                                    |
| `image_url_cleaned`       | `image_url_cleaned`          | Placeholder-cleaned image URL.                                                      |
| `manufacturer_normalized` | `manufacturer_normalized`    | Manufacturer name with common suffixes stripped.                                    |
| `approval_codes`          | `approval_codes`             | All extracted approval codes as a JSONB array.                                      |
| `best_match_type`         | `best_match_type`            | `exact_code` or `fuzzy_name`.                                                       |
| `best_match_score`        | `best_match_score`           | Score of the best matched instruction.                                              |
| `top_candidate_ids`       | `top_candidate_ids`          | Top-5 instruction candidate ids as a JSONB array.                                   |
| `top_candidate_scores`    | `top_candidate_scores`       | Top-5 candidate scores as a JSONB array.                                            |
| `candidate_count`         | `candidate_count`            | Number of candidates considered.                                                    |
| `match_quality_overall`   | `match_quality_overall`      | Composite quality score (0-~200).                                                   |
| `match_quality_approval`  | `match_quality_approval`     | Approval-code match quality component.                                              |
| `match_quality_name`      | `match_quality_name`         | Name match quality component.                                                       |
| `match_quality_maker`     | `match_quality_maker`        | Manufacturer match quality component.                                               |
| `match_quality_leaflet`   | `match_quality_leaflet`      | Leaflet completeness quality component.                                             |
| `match_quality_penalty`   | `match_quality_penalty`      | Multi-candidate / conflict penalty.                                                 |
| `match_quality_notes`     | `match_quality_notes`        | Quality notes as a JSONB array.                                                     |
| `drugbank_ids`            | `drugbank_ids`               | Optional DrugBank ids as a JSONB array.                                             |

In V2, `ProductsEnriched` no longer flattens matched instruction text into the product row. Structured instruction text lives in `cn_medicine_leaflets`, and `cn_medicine_products` only carries metadata (`best_instruction_id`, `best_match_type`, `match_quality_*`, `top_candidate_ids`, etc.) to select and rank leaflets. `overdose` has no yaozs counterpart and remains from `FullDrugDetail`.

Recommended technical fields:

| Field                       | Notes                                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | Lucent UUID or generated stable id.                                                                                                            |
| `source_name`               | Constant such as `chinese_drug_data_master`.                                                                                                   |
| `source_row_number`         | Original row number for traceability.                                                                                                          |
| `search_text`               | Generated text for full-text search from name, brand, manufacturer, normalized manufacturer, approval number, barcode, and national drug code. |
| `created_at` / `updated_at` | Lucent timestamps.                                                                                                                             |

Suggested uniqueness rules:

- Prefer `(approval_number, package_spec, manufacturer)` when `approval_number` exists.
- Fall back to `(name, package_spec, manufacturer, national_drug_code)` when approval number is missing.
- Keep apparent duplicates in staging and report them during import instead of silently dropping rows.

## CN Master Build (V2)

The canonical Chinese import source is generated, not hand-maintained. **4.0.0 locks the V2 fusion result; no further fusion-quality iterations are planned for this release.**

```powershell
cd ..\DrugDataBase
python -m venv .venv
.venv\Scripts\python -m pip install openpyxl
.venv\Scripts\python ChineseDrugData_Master_V2\build_master_v2.py
```

On msys bash use `.venv/bin/python` instead of `.venv\Scripts\python`.

`build_master_v2.py` reads:

- `FullDrugDetail.xlsx` (product catalog)
- `药品说明书数据库_医药数据查询/*.xlsx` (yaozs leaflets)

and writes `ChineseDrugData_Master_V2/ChineseDrugData_Master_V2.xlsx` with these sheets:

| Sheet                     | Purpose                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `Summary`                 | Build metadata and counts.                                                                                                                   |
| `ProductsEnriched`        | One row per FullDrugDetail product, with `best_instruction_id` and quality metadata. This is the sheet imported into `cn_medicine_products`. |
| `OrphanInstructions`      | Instruction rows that did not match any product. Kept for future use, not imported in Phase 1.                                               |
| `InstructionsClean`       | All kept instruction rows in normalized English column names.                                                                                |
| `ProductInstructionLinks` | Exact-code product-instruction links with match type, match key, and text match score.                                                       |
| `FuzzyMatches`            | Fuzzy-name fallback matches (truncated to the first 100k rows in the `.xlsx`; full audit data must be exported separately if needed).        |
| `Conflicts`               | Instruction rows where `编号` and `批准文号` extracted disjoint approval codes.                                                              |
| `DroppedSummary`          | Low-value instruction rows dropped during build (empty or minimal content).                                                                  |

Key V2 improvements over V1:

- **Coverage:** instruction matching rose from ~56% to ~85.7% via fuzzy-name fallback.
- **Quality scores:** every product row carries `match_quality_*` fields so search/retrieval can rank exact matches above fuzzy matches.
- **Multiple candidates:** top-5 instruction candidates are retained per product.
- **Normalized manufacturers:** `manufacturer_normalized` improves matching and search.
- **Cleaned images:** placeholder image URLs are emptied.
- **DrugBank bridge:** optional `drugbank_ids` field for future scientific enrichment.

Cleaning rules applied during build:

- All text fields are whitespace-normalized and illegal Excel characters removed.
- Markers such as `尚不明确`, `无`, `null`, `重复资料` are treated as empty.
- Approval codes are extracted from both `编号` and `批准文号` using pattern `[A-Z]{1,3}\d{8}`. When the two fields disagree, `批准文号` is preferred and the row is flagged as `approval_conflict`.
- Product-instruction matching first uses approval code; unmatched products then fall back to fuzzy matching on generic name and normalized manufacturer.
- Instruction rows without approval codes and fewer than two meaningful leaflet fields are dropped as low value.

Producer name normalization **is** applied in V2 via suffix stripping (`有限公司`, `制药厂`, `药业`, etc.) and stored in `manufacturer_normalized`.

## DrugBank Source Mapping

Import `unziped/full database.xml` into a raw staging representation first, then normalize selected fields into `drugbank_drugs`.

| DrugBank XML field                                          | `drugbank_drugs` field   | Notes                                                                     |
| ----------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------- |
| primary `<drugbank-id>`                                     | `drugbank_id`            | Required stable id, e.g. `DB00001`.                                       |
| non-primary `<drugbank-id>`                                 | `secondary_drugbank_ids` | String array or JSON.                                                     |
| `<drug type="">`                                            | `drug_type`              | DrugBank drug type.                                                       |
| `<drug created="">`                                         | `source_created_at`      | Source date.                                                              |
| `<drug updated="">`                                         | `source_updated_at`      | Source date.                                                              |
| `<name>`                                                    | `name`                   | Required English display/search name.                                     |
| `<description>`                                             | `description`            | English summary.                                                          |
| `<cas-number>`                                              | `cas_number`             | Identifier.                                                               |
| `<unii>`                                                    | `unii`                   | Identifier.                                                               |
| `<state>`                                                   | `state`                  | Physical state.                                                           |
| `<groups><group>`                                           | `groups`                 | String array or JSON.                                                     |
| `<indication>`                                              | `indication`             | Clinical indication text.                                                 |
| `<pharmacodynamics>`                                        | `pharmacodynamics`       | Scientific detail.                                                        |
| `<mechanism-of-action>`                                     | `mechanism_of_action`    | Scientific detail.                                                        |
| `<toxicity>`                                                | `toxicity`               | Scientific detail.                                                        |
| `<metabolism>`                                              | `metabolism`             | Scientific detail.                                                        |
| `<absorption>`                                              | `absorption`             | Scientific detail.                                                        |
| `<half-life>`                                               | `half_life`              | Scientific detail.                                                        |
| `<protein-binding>`                                         | `protein_binding`        | Scientific detail.                                                        |
| `<route-of-elimination>`                                    | `route_of_elimination`   | Scientific detail.                                                        |
| `<volume-of-distribution>`                                  | `volume_of_distribution` | Scientific detail.                                                        |
| `<clearance>`                                               | `clearance`              | Scientific detail.                                                        |
| `<classification>`                                          | `classification`         | JSON because the node is hierarchical.                                    |
| `<synonyms>`                                                | `synonyms`               | String array or JSON.                                                     |
| `<products>`                                                | `products`               | JSON; not treated as Chinese products.                                    |
| `<international-brands>`                                    | `international_brands`   | JSON/string array.                                                        |
| `<categories>`                                              | `categories`             | JSON/string array.                                                        |
| `<atc-codes>`                                               | `atc_codes`              | String array or JSON.                                                     |
| `<food-interactions>`                                       | `food_interactions`      | JSON/string array.                                                        |
| `<drug-interactions>`                                       | `drug_interactions`      | JSON array keyed by interacting DrugBank id/name.                         |
| `<external-identifiers>`                                    | `external_identifiers`   | Also mirror into `drugbank_external_links`.                               |
| `<external-links>`                                          | `external_links`         | Also mirror into `drugbank_external_links`.                               |
| `<targets>` / `<enzymes>` / `<carriers>` / `<transporters>` | relationship tables      | Keep as normalized relationship rows or JSON until target APIs need them. |

Import `unziped/drug links.csv` into `drugbank_external_links`.

| CSV column                                                           | Field                                          | Notes                                            |
| -------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| `DrugBank ID`                                                        | `drugbank_id`                                  | Foreign key to `drugbank_drugs`.                 |
| `Name`                                                               | `drug_name`                                    | Redundant source display text.                   |
| `CAS Number`                                                         | `cas_number`                                   | Can validate/mirror `drugbank_drugs.cas_number`. |
| `Drug Type`                                                          | `drug_type`                                    | Can validate/mirror `drugbank_drugs.drug_type`.  |
| `KEGG Compound ID` / `KEGG Drug ID`                                  | `kegg_compound_id` / `kegg_drug_id`            | External ids.                                    |
| `PubChem Compound ID` / `PubChem Substance ID`                       | `pubchem_compound_id` / `pubchem_substance_id` | External ids.                                    |
| `ChEBI ID`                                                           | `chebi_id`                                     | External id.                                     |
| `PharmGKB ID`                                                        | `pharmgkb_id`                                  | External id.                                     |
| `HET ID`                                                             | `het_id`                                       | External id.                                     |
| `UniProt ID` / `UniProt Title`                                       | `uniprot_id` / `uniprot_title`                 | External target/protein hint.                    |
| `GenBank ID`                                                         | `genbank_id`                                   | External id.                                     |
| `DPD ID`                                                             | `dpd_id`                                       | External id.                                     |
| `RxList Link` / `Pdrhealth Link` / `Wikipedia ID` / `Drugs.com Link` | link fields                                    | Keep as source references.                       |
| `NDC ID`                                                             | `ndc_id`                                       | US package/product identifier when present.      |

Import `unziped/all.csv` or `unziped/pharmacologically_active.csv` into target tables.

| CSV column                                | `drugbank_targets` / relationship field  | Notes                                                 |
| ----------------------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| `ID`                                      | `source_target_id`                       | Source row id.                                        |
| `Name`                                    | `name`                                   | Target display name.                                  |
| `Gene Name`                               | `gene_name`                              | Target gene symbol.                                   |
| `GenBank Protein ID` / `GenBank Gene ID`  | `genbank_protein_id` / `genbank_gene_id` | External ids.                                         |
| `UniProt ID` / `Uniprot Title`            | `uniprot_id` / `uniprot_title`           | External ids.                                         |
| `PDB ID`                                  | `pdb_ids`                                | Split semicolon-delimited values.                     |
| `GeneCard ID` / `GenAtlas ID` / `HGNC ID` | corresponding fields                     | External ids.                                         |
| `Species`                                 | `species`                                | Target species.                                       |
| `Drug IDs`                                | `drugbank_drug_targets.drugbank_id`      | Split semicolon-delimited ids into relationship rows. |
| `Actions`                                 | `drugbank_drug_targets.actions`          | Split semicolon-delimited action labels when present. |
| `Known Action`                            | `drugbank_drug_targets.known_action`     | Preserve source yes/no or descriptive text.           |

FASTA and SDF files are not needed for Phase 1 search/detail. Keep them outside the database until a feature requires sequences or structures.

## Query Selection

Medicine APIs must select the source table explicitly from a frontend-provided medicine source parameter:

```text
source=cn       -> query cn_medicine_products
source=drugbank -> query drugbank_drugs
```

Do not use `Accept-Language` as the table selector. `Accept-Language` controls response messages and generic localization only. The medicine source controls which dataset is queried.

Default behavior:

- If `source` is missing, Lucent uses `drugbank` for medicine search/detail because the current product direction is personal health copilot knowledge-first.
- If `source=cn`, ids refer to `cn_medicine_products.id`.
- If `source=drugbank`, ids refer to `drugbank_drugs.drugbank_id`.
- Cross-source matching is not automatic. If a future detail page wants enrichment, it should use reviewed rows from `medicine_source_matches`.

## API Shape for Different Field Sets

Search responses should expose a common card shape so Flutter can render mixed or switched sources without knowing every source-specific field:

| Common field | `source=drugbank` value                         | `source=cn` value                           |
| ------------ | ----------------------------------------------- | ------------------------------------------- |
| `id`         | `drugbank_drugs.drugbank_id`                    | `cn_medicine_products.id`                   |
| `source`     | `drugbank`                                      | `cn`                                        |
| `name`       | English drug name                               | Chinese product name                        |
| `subtitle`   | CAS number, groups, or category summary         | Brand, package spec, or manufacturer        |
| `summary`    | Description or indication preview               | Indications or instructions preview         |
| `tags`       | Groups, categories, ATC snippets                | Drug type, main category, subcategory       |
| `imageUrl`   | Usually null unless a later source provides one | `image_url`                                 |
| `matchedBy`  | Name, synonym, identifier, target, etc.         | Name, brand, approval number, barcode, etc. |

Detail responses should use a discriminated union:

```json
{
  "id": "DB01050",
  "source": "drugbank",
  "name": "Ibuprofen",
  "subtitle": "CAS 15687-27-1",
  "detail": {
    "kind": "drugbank",
    "description": "...",
    "indication": "...",
    "mechanismOfAction": "...",
    "pharmacodynamics": "...",
    "drugInteractions": []
  }
}
```

```json
{
  "id": "cn_...",
  "source": "cn",
  "name": "布洛芬缓释胶囊",
  "subtitle": "0.3g / 某某制药",
  "detail": {
    "kind": "cnProduct",
    "approvalNumber": "...",
    "manufacturer": "...",
    "packageSpec": "...",
    "indications": "...",
    "dosage": "...",
    "contraindications": "..."
  }
}
```

This keeps frontend rendering stable while letting each source keep its real schema.

## Ownership

- Lucent owns all imports, normalization, validation, and source mapping.
- PostgreSQL is the durable query source after import.
- Flutter only consumes Lucent APIs and may keep small user-owned offline cache snapshots.

## Import Rules

- Keep raw Chinese and DrugBank imports in separate staging tables first.
- Do not merge Chinese product records with DrugBank records until matching rules are reviewed.
- Use small fixtures for tests; do not run normal tests against the full xlsx or full XML.
- Import scripts must be idempotent and report source rows, imported rows, rejected rows, and sample rejection reasons.
- Import scripts should also stamp `drug_source_imports` with source file name, optional source version, optional SHA-256 hash, and batch-level rejection samples.
- Large files remain outside Git, generated dumps remain outside Git, and Flutter assets must not include these sources.

## Open Decisions

- DrugBank licensing and which fields can be used in user-facing responses.
- Matching strategy between Chinese products and DrugBank drugs.
- Whether image URLs should be proxied, cached, or left as source references.
