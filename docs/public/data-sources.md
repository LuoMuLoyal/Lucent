# Data Sources

本文档保留数据源索引与概述。

子文档：

- [[data-sources-cn-products]]
- [[data-sources-drugbank]]
- [[data-sources-medical-qa]]
- [[data-sources-food-composition]]

## Target Directory

Local external data directory:

```text
D:\25080\Documents\VSCodeProject\Lumos\DrugDataBase
```

This directory is not tracked by Git and must not be packaged into Flutter.

## Current Sources

- `FullDrugDetail.xlsx`: raw Chinese medicine product catalog (product metadata, sparse instruction
  fields).
- `药品说明书数据库_医药数据查询/`: raw scraped Chinese medicine leaflets from yaozs.com (rich instruction text,
  sparse product metadata).
- `ChineseDrugData_Master_V2/ChineseDrugData_Master_V2.xlsx`: **recommended CN source for Lucent as
  of 4.0.0**. Built by `DrugDataBase/ChineseDrugData_Master_V2/build_master_v2.py` from the two
  sources above. Each product row links to the best matched instruction via `best_instruction_id`;
  instruction text is no longer flattened into the product row. V1 (`ChineseDrugData_Master.xlsx`)
  is kept as an archived reference and should not be used for new imports.
- DrugBank files: English scientific enrichment source, including XML, CSV, FASTA, and SDF assets.

## Practical Import Workflow

1. Build the CN master file first (details in [[data-sources-cn-products]]).
2. Start local infrastructure: `pnpm dev:stack`, `pnpm db:migrate`.
3. Use idempotent scripts for DrugBank XML; the Chinese master source can also be handled by GUI
   tools
   or scripts.
4. Lucent has durable destination tables for both sources.

## Scripted Import Commands

Default entrypoint:

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
- `cn_medicine_product_leaflet_links` depends on both `cn_medicine_products` and
  `cn_medicine_leaflets`, so it runs last.

Smoke-test example:

```powershell
node scripts/import/medicine/import-medicine-datasets.ts --limit 20 --with-hash
```

Useful options include `-Command <dataset>`, `-SourcePath <file>`, `-NodeEnv test`, `-BatchSize
<n>`,
`-SourceVersion <date>`, and `-WithHash`. Source-specific notes live in the relevant sub-doc.

Import batches are deduplicated by the target table conflict key before upsert, keeping smoke and
full
imports idempotent.

## Medicine Data Strategy

Lucent keeps the Chinese and English medicine datasets separate at query time. The two sources
describe different things:

- English source (DrugBank XML/CSV): scientific drug entities, identifiers, mechanisms,
  pharmacology, targets, and interactions. This is the default medicine knowledge source for the
  personal health copilot.
- Chinese source (`ChineseDrugData_Master_V2/ChineseDrugData_Master_V2.xlsx`): Chinese market
  medicine products linked to package insert text, with quality scores and candidate metadata. This
  is the locked regional execution source for Chinese product/package lookup and CN leaflet RAG in
  4.0.0.

Do not force both sources into one canonical medicine table in Phase 1. Matching Chinese products to
DrugBank drug entities is a later enrichment task because one Chinese product can map to multiple
active ingredients, and one DrugBank drug can map to many brands/products.

Assistant tooling now also reflects this separation:

- `search_cn_medicine_products`
- `get_cn_medicine_detail`
- `get_drugbank_detail`

The two datasets do not have the same field model. Lucent should handle this with two layers:

1. A small common response layer for search lists and generic detail headers.
2. A source-specific detail payload that preserves each dataset's native fields.

Do not invent empty columns just to make `cn_medicine_products` and `drugbank_drugs` look identical.
Missing or irrelevant source fields should stay absent from the source-specific payload.

Recommended durable tables after staging:

- **`cn_medicine_products`**: One row per Chinese product/specification from
  `ChineseDrugData_Master_V2.xlsx`.
- **`cn_medicine_leaflets`**: One row per cleaned yaozs instruction from
  `ChineseDrugData_Master_V2.xlsx`.
- **`cn_medicine_product_leaflet_links`**: Product-to-leaflet links with match type, approval code,
  and match score from `ChineseDrugData_Master_V2.xlsx`.
- **`medicine_leaflet_chunks`**: Chunked leaflet text for RAG; empty until the rebuild-leaflet-index
  pipeline runs.
- **`drugbank_drugs`**: One row per primary DrugBank drug entry from `full database.xml`.
- **`drugbank_external_links`**: External identifiers and consumer links from `drug links.csv` plus
  XML external identifiers/links.
- **`drugbank_targets`**: Target/polypeptide rows from `all.csv` or `pharmacologically_active.csv`.
- **`drugbank_drug_targets`**: Many-to-many relationship between DrugBank drugs and target rows.
- **`drugbank_passage_chunks`**: Chunked narrative passages from `drugbank_drugs` for RAG; empty
  until the rebuild-drugbank-rag-index pipeline runs.
- **`medical_qa_chunks`**: Filtered question/answer pairs from the medical QA corpus for
  assistant-only RAG.
- **`drug_source_imports`**: Import run metadata: source name, version/export date, file hash, row
  counts, rejection summary.

These durable tables now exist in Lucent's Prisma schema and migration history. Local development
currently holds 100-record smoke-test subsets for DrugBank drugs, DrugBank passage chunks, and
medical QA chunks; full imports remain optional and are run with the same scripts using higher or
omitted `--limit` values.

Optional later table:

- **None currently planned**: Lucent does not maintain a runtime mapping table between
  `cn_medicine_products` and `drugbank_drugs`. Cross-source questions are handled by the assistant's
  source-split structured lookup tools rather than a shared bridge table.

## Query Selection

Medicine APIs must select the source table explicitly from a frontend-provided medicine source
parameter:

```text
source=cn       -> query cn_medicine_products
source=drugbank -> query drugbank_drugs
```

Do not use `Accept-Language` as the table selector. `Accept-Language` controls response messages and
generic localization only. The medicine source controls which dataset is queried.

Default behavior:

- If `source` is missing, Lucent uses `drugbank` for medicine search/detail because the current
  product direction is personal health copilot knowledge-first.
- If `source=cn`, ids refer to `cn_medicine_products.id`.
- If `source=drugbank`, ids refer to `drugbank_drugs.drugbank_id`.
- Cross-source matching is not automatic. The assistant should use the source-split structured
  medicine lookup tools rather than a shared mapping table.

## API Shape for Different Field Sets

Search responses expose a common card shape so Flutter can render mixed or switched sources without
knowing every source-specific field:

- **`id`** → `drugbank_drugs.drugbank_id` — `cn_medicine_products.id`
- **`source`** → `drugbank` — `cn`
- **`name`** → English drug name — Chinese product name
- **`subtitle`** → CAS number, groups, or category summary — brand, package spec, or manufacturer
- **`summary`** → description or indication preview — indications or instructions preview
- **`tags`** → groups, categories, ATC snippets — drug type, main category, subcategory
- **`imageUrl`** → usually null unless a later source provides one — `image_url`
- **`matchedBy`** → name, synonym, identifier, target, etc. — name, brand, approval number, barcode,
  etc.

Detail responses use a discriminated union (`kind: drugbank` vs `kind: cnProduct`) so each source
can
keep its real schema.

## Ownership

- Lucent owns all imports, normalization, validation, and source mapping.
- PostgreSQL is the durable query source after import.
- Flutter only consumes Lucent APIs and may keep small user-owned offline cache snapshots.

## Import Rules

- Keep raw Chinese and DrugBank imports in separate staging tables first.
- Do not merge Chinese product records with DrugBank records until matching rules are reviewed.
- Use small fixtures for tests; do not run normal tests against the full xlsx or full XML.
- Import scripts must be idempotent and report source rows, imported rows, rejected rows, and sample
  rejection reasons.
- Import scripts should also stamp `drug_source_imports` with source file name, optional source
  version, optional SHA-256 hash, and batch-level rejection samples.
- Large files remain outside Git, generated dumps remain outside Git, and Flutter assets must not
  include these sources.

## Open Decisions

- DrugBank licensing and which fields can be used in user-facing responses.
- Matching strategy between Chinese products and DrugBank drugs.
- Whether image URLs should be proxied, cached, or left as source references.

## RAG Knowledge Sources

Assistant retrieval keeps each corpus separate. Lucent does not merge Chinese leaflet, DrugBank
scientific passages, and medical QA into one embedding table or one generic search tool.

Assistant structured medicine lookup is also source-owned rather than merged:

- Chinese structured product search/detail stays on `cn_medicine_products`
- DrugBank structured detail stays on `drugbank_drugs`
- Cross-source matching is not performed by a maintained runtime bridge or alias table. The
  assistant resolves cross-source questions on demand using source-split structured lookup tools
  (`search_cn_medicine_products`, `get_cn_medicine_detail`, `get_drugbank_detail`,
  `search_medicine_leaflets`, `search_drugbank_passages`).

- Chinese leaflet RAG 细节见 [[data-sources-cn-products]]。
- DrugBank assistant RAG 细节见 [[data-sources-drugbank]]。
- Medical QA corpus 细节见 [[data-sources-medical-qa]]。
