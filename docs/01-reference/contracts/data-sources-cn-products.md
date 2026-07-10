# Data Sources: Chinese Products And Leaflets

本文件是 [[data-sources]] 拆分后的子文档。

相关子文档：

- [[data-sources-drugbank]]
- [[data-sources-medical-qa]]
- [[data-sources-food-composition]]

## Chinese Source Mapping

Import `ChineseDrugData_Master_V2/ChineseDrugData_Master_V2.xlsx` sheets into Lucent-owned durable
tables:

- `ProductsEnriched` -> `cn_medicine_products`
- `InstructionsClean` -> `cn_medicine_leaflets`
- `ProductInstructionLinks` -> `cn_medicine_product_leaflet_links`

These sheets are produced by `DrugDataBase/ChineseDrugData_Master_V2/build_master_v2.py`, which
merges:

- `FullDrugDetail.xlsx` product catalog fields.
- The cleaned instruction rows from `药品说明书数据库_医药数据查询/` (yaozs.com leaflets).

Product-level fields come from `FullDrugDetail.xlsx`; canonical instruction text comes from the
cleaned yaozs rows. When no instruction matches a product, the product row still exists in
`cn_medicine_products`, but it will have no linked rows in `cn_medicine_product_leaflet_links`.

- **`product_name`** → `name` — Required search/display name. Keep the original text.
- **`image_url`** → `image_url` — Keep source URL; proxy/cache decision remains separate.
- **`price`** → `price_text` — Keep as text because values may be empty or non-normalized.
- **`package_spec`** → `package_spec` — Product-specific strength/package text.
- **`approval_number`** → `approval_number` — Chinese approval number; useful for dedupe and detail
  display.
- **`manufacturer`** → `manufacturer` — Manufacturer display/filter field.
- **`drug_type`** → `drug_type` — Example: prescription / OTC text.
- **`main_category`** → `main_category` — Broad category.
- **`subcategory`** → `subcategory` — Secondary category.
- **`detail_url`** → `source_url` — Original detail page.
- **`brand_name`** → `brand_name` — Optional brand/trade name.
- **`ingredients`** → `ingredients` — Package insert field.
- **`properties`** → `properties` — Package insert field.
- **`indications`** → `indications` — Package insert field.
- **`dosage`** → `dosage` — Package insert field.
- **`adverse_reactions`** → `adverse_reactions` — Package insert field.
- **`contraindications`** → `contraindications` — Package insert field.
- **`precautions`** → `precautions` — Package insert field.
- **`pediatric_use`** → `pediatric_use` — Package insert field.
- **`geriatric_use`** → `geriatric_use` — Package insert field.
- **`pregnancy_lactation`** → `pregnancy` + `lactation` — Package insert field; API splits sentences
  by context keywords into two DTO fields.
- **`pharmacology_toxicology`** → `pharmacology_toxicology` — Package insert field.
- **`drug_interactions`** → `drug_interactions` — Package insert field.
- **`pharmacokinetics`** → `pharmacokinetics` — Package insert field.
- **`overdose`** → `overdose` — Kept from `FullDrugDetail`; yaozs source does not provide this
  field.
- **`storage`** → `storage` — Enriched from matched yaozs instruction when available.
- **`validity_period`** → `validity_period` — Enriched from matched yaozs instruction when
  available.
- **`barcode`** → `barcode` — Product barcode when present.
- **`national_drug_code`** → `national_drug_code` — National drug code when present.
- **`image_url_cleaned`** → `image_url_cleaned` — Placeholder-cleaned image URL.
- **`manufacturer_normalized`** → `manufacturer_normalized` — Manufacturer name with common suffixes
  stripped.
- **`approval_codes`** → `approval_codes` — All extracted approval codes as a JSONB array.
- **`best_match_type`** → `best_match_type` — `exact_code` or `fuzzy_name`.
- **`best_match_score`** → `best_match_score` — Score of the best matched instruction.
- **`top_candidate_ids`** → `top_candidate_ids` — Top-5 instruction candidate ids as a JSONB array.
- **`top_candidate_scores`** → `top_candidate_scores` — Top-5 candidate scores as a JSONB array.
- **`candidate_count`** → `candidate_count` — Number of candidates considered.
- **`match_quality_overall`** → `match_quality_overall` — Composite quality score (0-~200).
- **`match_quality_approval`** → `match_quality_approval` — Approval-code match quality component.
- **`match_quality_name`** → `match_quality_name` — Name match quality component.
- **`match_quality_maker`** → `match_quality_maker` — Manufacturer match quality component.
- **`match_quality_leaflet`** → `match_quality_leaflet` — Leaflet completeness quality component.
- **`match_quality_penalty`** → `match_quality_penalty` — Multi-candidate / conflict penalty.
- **`match_quality_notes`** → `match_quality_notes` — Quality notes as a JSONB array.
- **`drugbank_ids`** → `drugbank_ids` — Optional source field, currently not populated in the local
  V2 snapshot and not used as a runtime bridge.

In V2, `ProductsEnriched` no longer flattens matched instruction text into the product row.
Structured instruction text lives in `cn_medicine_leaflets`, and `cn_medicine_products` only carries
metadata (`best_instruction_id`, `best_match_type`, `match_quality_*`, `top_candidate_ids`, etc.) to
select and rank leaflets. `overdose` has no yaozs counterpart and remains from `FullDrugDetail`.

Recommended technical fields:

- **`id`**: Lucent UUID or generated stable id.
- **`source_name`**: Constant such as `chinese_drug_data_master`.
- **`source_row_number`**: Original row number for traceability.
- **`search_text`**: Generated text for full-text search from name, brand, manufacturer, normalized
  manufacturer, approval number, barcode, and national drug code.
- **`created_at` / `updated_at`**: Lucent timestamps.

Suggested uniqueness rules:

- Prefer `(approval_number, package_spec, manufacturer)` when `approval_number` exists.
- Fall back to `(name, package_spec, manufacturer, national_drug_code)` when approval number is
  missing.
- Keep apparent duplicates in staging and report them during import instead of silently dropping
  rows.

## CN Master Build (V2)

The canonical Chinese import source is generated, not hand-maintained. **4.0.0 locks the V2 fusion
result; no further fusion-quality iterations are planned for this release.**

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

- **`Summary`**: Build metadata and counts.
- **`ProductsEnriched`**: One row per FullDrugDetail product, with `best_instruction_id` and quality
  metadata. This is the sheet imported into `cn_medicine_products`.
- **`OrphanInstructions`**: Instruction rows that did not match any product. Kept for future use,
  not imported in Phase 1.
- **`InstructionsClean`**: All kept instruction rows in normalized English column names.
- **`ProductInstructionLinks`**: Exact-code product-instruction links with match type, match key,
  and text match score.
- **`FuzzyMatches`**: Fuzzy-name fallback matches (truncated to the first 100k rows in the `.xlsx`;
  full audit data must be exported separately if needed).
- **`Conflicts`**: Instruction rows where `编号` and `批准文号` extracted disjoint approval codes.
- **`DroppedSummary`**: Low-value instruction rows dropped during build (empty or minimal content).

Key V2 improvements over V1:

- **Coverage:** instruction matching rose from ~56% to ~85.7% via fuzzy-name fallback.
- **Quality scores:** every product row carries `match_quality_*` fields so search/retrieval can
  rank exact matches above fuzzy matches.
- **Multiple candidates:** top-5 instruction candidates are retained per product.
- **Normalized manufacturers:** `manufacturer_normalized` improves matching and search.
- **Cleaned images:** placeholder image URLs are emptied.
- **DrugBank bridge:** optional `drugbank_ids` source field; currently not populated and not used as
  a runtime bridge.

Cleaning rules applied during build:

- All text fields are whitespace-normalized and illegal Excel characters removed.
- Markers such as `尚不明确`, `无`, `null`, `重复资料` are treated as empty.
- Approval codes are extracted from both `编号` and `批准文号` using pattern `[A-Z]{1,3}\d{8}`. When the
  two fields disagree, `批准文号` is preferred and the row is flagged as `approval_conflict`.
- Product-instruction matching first uses approval code; unmatched products then fall back to fuzzy
  matching on generic name and normalized manufacturer.
- Instruction rows without approval codes and fewer than two meaningful leaflet fields are dropped
  as low value.

Producer name normalization **is** applied in V2 via suffix stripping (`有限公司`, `制药厂`, `药业`, etc.)
and stored in `manufacturer_normalized`.

### Chinese leaflet RAG

Chinese leaflet RAG uses chunked package-insert text from `cn_medicine_leaflets`.

- chunk rows live in `medicine_leaflet_chunks`
- vector index rows live in a dedicated PGVector-backed leaflet store
- retrieval is exposed through `search_medicine_leaflets`
- `search_medicine_leaflets` resolves the product by aggregating vector chunk scores over the
  leaflet store before returning chunks

Rebuild pipeline:

```bash
pnpm exec ts-node scripts/import/medicine/rebuild-leaflet-index.ts --embed --embed-limit 100
```

The retrieval path stays product-scoped and vector-first. A retrieval miss does not fall back to
keyword guessing.

## Import Notes

- The default source for all CN commands is
  `../DrugDataBase/ChineseDrugData_Master_V2/ChineseDrugData_Master_V2.xlsx`.
- `cn-products` reads sheet `ProductsEnriched`.
- `cn-leaflets` reads sheet `InstructionsClean`.
- `cn-product-leaflet-links` reads both `ProductsEnriched` (for product id mapping and best-match
  metadata) and `ProductInstructionLinks` (exact-code candidates), then guarantees a best-match link
  for every product regardless of whether it was matched by `exact_code` or `fuzzy_name`.
- If you need to override, pass `--source <path>` to the import command.
- `scripts/import/medicine/parsers/cn_products.py` supports both `.xlsx` and `.csv`.
- If `openpyxl` is not available, export `FullDrugDetail.xlsx` sheet `总的` to CSV and pass `--source`
  / `-Command cn-products` with that CSV path.
