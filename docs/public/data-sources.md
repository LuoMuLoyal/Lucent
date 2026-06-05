# Data Sources

Last updated: 2026-06-05

## Target Directory

Local external data directory:

```text
D:\25080\Documents\VSCodeProject\Lumos\DrugDataBase
```

This directory is not tracked by Git and must not be packaged into Flutter.

## Current Sources

- `FullDrugDetail.xlsx`: detailed Chinese medicine product and instruction source.
- DrugBank files: English scientific enrichment source, including XML, CSV, FASTA, and SDF assets.

## Practical Import Workflow

- `FullDrugDetail.xlsx` can be imported with GUI tools such as DBeaver when we need a quick raw/staging load or spot-check import.
- `drug links.csv`, `all.csv`, and `pharmacologically_active.csv` can also be handled by DBeaver or regular PostgreSQL CSV import flows.
- `full database.xml` should not be treated as a manual GUI import. It is about 1.9 GB after unzip and should be parsed by an idempotent script into normalized tables.
- Do not convert `full database.xml` to `xlsx` as a normal workflow. `xlsx` adds a row/column flattening step, size overhead, Excel/DBeaver cell limits, and loses the benefit of streaming the XML incrementally.
- Lucent now has durable destination tables for both sources. Tool-based import is acceptable for the Chinese source, but the DrugBank XML path should stay scripted so we can reproduce it.

## Scripted Import Commands

Recommended local preparation:

1. `pnpm dev:stack:up`
2. `pnpm db:migrate:all`
3. `pip install -r scripts/medicine/requirements.txt` if the Chinese source is still `.xlsx`

Default scripted import order:

```bash
pnpm import:medicine:all
```

This runs:

1. `drugbank-drugs`
2. `drugbank-links`
3. `drugbank-targets-all`
4. `drugbank-targets-active`
5. `cn-products`

Why this order:

- `drugbank_external_links` depends on `drugbank_drugs.drugbank_id`.
- `drugbank_drug_targets` depends on both imported DrugBank drugs and imported target rows.
- Chinese products are independent and can run last.

Smoke-test example:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev/import-medicine-datasets.ps1 -Limit 20 -WithHash
```

Useful options:

- `-Command cn-products` or `-Command drugbank-drugs` to run one dataset only.
- `-SourcePath <file>` to override the default file for a single dataset import.
- `-NodeEnv test` to target the test database intentionally.
- `-BatchSize 250` to tune upsert batch size.
- `-SourceVersion 2026-05-30` to persist the export/version string into `drug_source_imports.source_version`.
- `-WithHash` to store a SHA-256 file hash in `drug_source_imports.source_file_hash`.

Import batches are deduplicated by the target table conflict key before upsert. This keeps smoke and full imports idempotent when a source file emits multiple rows for the same durable record, such as repeated DrugBank primary ids in the XML stream.

Chinese source note:

- `scripts/medicine/parsers/cn_products.py` supports both `.xlsx` and `.csv`.
- If `openpyxl` is not available, export `FullDrugDetail.xlsx` sheet `总的` to CSV and pass `--source` / `-Command cn-products` with that CSV path.

## Medicine Data Strategy

Lucent keeps the Chinese and English medicine datasets separate at query time. The two sources describe different things:

- English source (DrugBank XML/CSV): scientific drug entities, identifiers, mechanisms, pharmacology, targets, and interactions. This is the default medicine knowledge source for the personal health copilot.
- Chinese source (`FullDrugDetail.xlsx`): Chinese market medicine products and package insert fields. This is the regional execution source for Chinese product/package lookup.

Do not force both sources into one canonical medicine table in Phase 1. Matching Chinese products to DrugBank drug entities is a later enrichment task because one Chinese product can map to multiple active ingredients, and one DrugBank drug can map to many brands/products.

The two datasets do not have the same field model. Lucent should handle this with two layers:

1. A small common response layer for search lists and generic detail headers.
2. A source-specific detail payload that preserves each dataset's native fields.

Do not invent empty columns just to make `cn_medicine_products` and `drugbank_drugs` look identical. Missing or irrelevant source fields should stay absent from the source-specific payload.

Recommended durable tables after staging:

| Table                     | Purpose                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `cn_medicine_products`    | One row per Chinese product/specification from `FullDrugDetail.xlsx`.                              |
| `drugbank_drugs`          | One row per primary DrugBank drug entry from `full database.xml`.                                  |
| `drugbank_external_links` | External identifiers and consumer links from `drug links.csv` plus XML external identifiers/links. |
| `drugbank_targets`        | Target/polypeptide rows from `all.csv` or `pharmacologically_active.csv`.                          |
| `drugbank_drug_targets`   | Many-to-many relationship between DrugBank drugs and target rows.                                  |
| `drug_source_imports`     | Import run metadata: source name, version/export date, file hash, row counts, rejection summary.   |

These durable tables now exist in Lucent's Prisma schema and migration history, even though the real source data has not been imported yet.

Optional later table:

| Table                     | Purpose                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `medicine_source_matches` | Reviewed mapping between `cn_medicine_products` and `drugbank_drugs`, with match method and confidence. |

## Chinese Source Mapping

Import `FullDrugDetail.xlsx` sheet `总的` into a raw staging table first, then normalize into `cn_medicine_products`.

| XLSX column               | `cn_medicine_products` field | Notes                                                          |
| ------------------------- | ---------------------------- | -------------------------------------------------------------- |
| `product_name`            | `name`                       | Required search/display name. Keep the original text.          |
| `image_url`               | `image_url`                  | Keep source URL; proxy/cache decision remains separate.        |
| `price`                   | `price_text`                 | Keep as text because values may be empty or non-normalized.    |
| `package_spec`            | `package_spec`               | Product-specific strength/package text.                        |
| `approval_number`         | `approval_number`            | Chinese approval number; useful for dedupe and detail display. |
| `manufacturer`            | `manufacturer`               | Manufacturer display/filter field.                             |
| `drug_type`               | `drug_type`                  | Example: prescription / OTC text.                              |
| `main_category`           | `main_category`              | Broad category.                                                |
| `subcategory`             | `subcategory`                | Secondary category.                                            |
| `detail_url`              | `source_url`                 | Original detail page.                                          |
| `brand_name`              | `brand_name`                 | Optional brand/trade name.                                     |
| `ingredients`             | `ingredients`                | Package insert field.                                          |
| `properties`              | `properties`                 | Package insert field.                                          |
| `indications`             | `indications`                | Package insert field.                                          |
| `dosage`                  | `dosage`                     | Package insert field.                                          |
| `adverse_reactions`       | `adverse_reactions`          | Package insert field.                                          |
| `contraindications`       | `contraindications`          | Package insert field.                                          |
| `precautions`             | `precautions`                | Package insert field.                                          |
| `pediatric_use`           | `pediatric_use`              | Package insert field.                                          |
| `geriatric_use`           | `geriatric_use`              | Package insert field.                                          |
| `pregnancy_lactation`     | `pregnancy_lactation`        | Package insert field.                                          |
| `pharmacology_toxicology` | `pharmacology_toxicology`    | Package insert field.                                          |
| `drug_interactions`       | `drug_interactions`          | Package insert field.                                          |
| `pharmacokinetics`        | `pharmacokinetics`           | Package insert field.                                          |
| `overdose`                | `overdose`                   | Package insert field.                                          |
| `storage`                 | `storage`                    | Package insert field.                                          |
| `validity_period`         | `validity_period`            | Package insert field.                                          |
| `barcode`                 | `barcode`                    | Product barcode when present.                                  |
| `national_drug_code`      | `national_drug_code`         | National drug code when present.                               |

Recommended technical fields:

| Field                       | Notes                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `id`                        | Lucent UUID or generated stable id.                                                                                   |
| `source_name`               | Constant such as `full_drug_detail`.                                                                                  |
| `source_row_number`         | Original row number for traceability.                                                                                 |
| `search_text`               | Generated text for full-text search from name, brand, manufacturer, approval number, barcode, and national drug code. |
| `created_at` / `updated_at` | Lucent timestamps.                                                                                                    |

Suggested uniqueness rules:

- Prefer `(approval_number, package_spec, manufacturer)` when `approval_number` exists.
- Fall back to `(name, package_spec, manufacturer, national_drug_code)` when approval number is missing.
- Keep apparent duplicates in staging and report them during import instead of silently dropping rows.

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
