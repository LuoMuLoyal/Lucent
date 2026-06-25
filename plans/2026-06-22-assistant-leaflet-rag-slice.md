# Assistant Leaflet RAG Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the first bounded Lucent RAG slice for medicine-leaflet
retrieval as an **assistant-only extra tool**, using a dedicated leaflet table
derived from the new merged CN master source.

**Architecture:** Keep product metadata in `cn_medicine_products` (from
`ChineseDrugData_Master.xlsx` sheet `ProductsEnriched`) and canonical leaflet
text in `cn_medicine_leaflets` (from sheet `InstructionsClean`). Link them
through `cn_medicine_product_leaflet_links` (from sheet
`ProductInstructionLinks`). RAG chunks reference leaflets, not denormalized
product columns, so provenance stays clean and one leaflet can serve multiple
products.

**Tech Stack:** NestJS 11, Prisma 7, PostgreSQL, optional `pgvector`, Python
`openpyxl` for source parsing.

---

## Goal

Define the first bounded Lucent RAG slice for medicine-leaflet retrieval as an
**assistant-only extra tool**, without turning retrieval into the primary
medicine-safety architecture.

This plan exists so the next backend step is executable after the user finishes
the upcoming UI/UX pass in Luminous.

## Update Notes (2026-06-25)

The data source layer changed in commits:

- `14a8da3 feat(import,docs): 使用 ChineseDrugData_Master 作为中文药品导入源`
- `a759ef3 fix(import): 修正药品导入脚本的路径解析`

Impact on this plan:

- The canonical CN source is now `DrugDataBase/ChineseDrugData_Master.xlsx`.
- It is produced by `DrugDataBase/build_cn_master.py`, which merges
  `FullDrugDetail.xlsx` (product catalog) with the scraped yaozs leaflets in
  `药品说明书数据库_医药数据查询/`.
- The workbook contains multiple sheets:
  - `ProductsEnriched` -> imported into `cn_medicine_products`.
  - `InstructionsClean` -> should now be imported into a new
    `cn_medicine_leaflets` table.
  - `ProductInstructionLinks` -> should now be imported into a new
    `cn_medicine_product_leaflet_links` table.
  - `OrphanInstructions`, `Conflicts`, `DroppedSummary`, `Summary` are kept for
    diagnostics but not imported in Phase 1.
- Because of this, the first RAG slice must chunk from `cn_medicine_leaflets`
  (the derived leaflet table) instead of from the leaflet columns on
  `cn_medicine_products`.

## Fixed Product/Architecture Constraints

- RAG is **not** allowed to replace the reviewed medicine safety rule engine.
- RAG is **not** allowed to become a general always-on assistant dependency.
- RAG is **not** allowed to silently mix Chinese insert text and DrugBank text
  into one fake canonical answer source.
- Assistant remains server-owned:
  - tool selection is controlled by Lucent
  - retrieval result shaping is controlled by Lucent
  - frontend only renders capability truth and final streamed output

## Intended Outcome

After this slice:

- Lucent can retrieve bounded medicine-leaflet evidence for explanation depth
  in assistant replies.
- Assistant capability truth can explicitly say when leaflet retrieval is
  available.
- Retrieved evidence is clearly framed as source-backed explanation material,
  not as an autonomous safety verdict.
- Retrieval sources from a clean, reproducible leaflet table that is separate
  from the product catalog table.

## Explicit Non-Scope

Do not include these in the first RAG slice:

- no replacement of `MedicineRiskChecker`
- no retrieval-driven red-flag logic
- no broad semantic search over every product feature in the app
- no web search
- no OCR / barcode / photo recognition
- no user-uploaded personal document indexing
- no cross-source automatic canonical entity resolution
- no frontend-first architecture where Luminous calls embedding/retrieval
  services directly
- no import of `OrphanInstructions` for RAG (keep them for later analysis only)

## Assumptions

- This is a judgment: the highest-value first use of RAG is assistant
  explanation depth for medicine questions, not direct medicine page rendering.
- The merged master workbook provides enough structure for a clean first slice:
  - `cn_medicine_products` for product metadata and product-to-leaflet matching.
  - `cn_medicine_leaflets` for canonical instruction text from
    `InstructionsClean`.
  - `cn_medicine_product_leaflet_links` for the best product-leaflet matches.
- Optional later DrugBank-backed scientific enrichment stays out of the first
  slice.
- Embedding role config already exists in Lucent env/config and should be
  reused instead of introducing a second embedding configuration path.

## Phase Boundary

Start with **CN leaflet retrieval first**.

Reason:

- Lucent now stores canonical leaflet rows in `cn_medicine_leaflets`.
- `cn_medicine_products` keeps product metadata and links to leaflets through
  `cn_medicine_product_leaflet_links`.
- The user-facing explanation value is more direct for regional medicine usage
  questions.
- It avoids premature cross-source entity matching.

DrugBank retrieval stays a later extension after the first CN slice proves
useful and safe.

## Proposed Delivery Order

### Phase 0: Retrieval Contract Decision

Lock the retrieval contract before coding:

- assistant gets **one new read tool**, not a new free-form subsystem
- tool shape should answer:
  - which medicine/source matched
  - which leaflet(s) were used
  - which text chunks were retrieved
  - why those chunks were selected
  - what coverage/ambiguity remains
- keep `ragEnabled` false until the full minimum slice is actually wired

### Phase 1: Data + Index Design

Decide the first durable storage/index approach.

New tables to add:

- `cn_medicine_leaflets`
  - one row per cleaned yaozs instruction from `InstructionsClean`
  - keeps source file/row provenance, approval codes, and all leaflet fields
  - does not duplicate product catalog fields
- `cn_medicine_product_leaflet_links`
  - one row per product-leaflet link from `ProductInstructionLinks`
  - keeps `product_id`, `leaflet_id`, `approval_code`, `match_score`
  - for the first slice, retrieval can use the best-scoring link per product
- `medicine_leaflet_chunks`
  - chunk text from `cn_medicine_leaflets`, not from `cn_medicine_products`
  - references `cn_medicine_leaflets.id`
  - keeps chunk metadata:
    - source kind
    - leaflet id
    - field name
    - chunk index
    - import version/hash

Chunk only reviewed CN leaflet fields such as:

- `indications`
- `dosage`
- `contraindications`
- `precautions`
- `pediatric_use`
- `geriatric_use`
- `pregnancy_lactation`
- `adverse_reactions`
- `drug_interactions`

Open implementation choice to settle during coding:

1. PostgreSQL + `pgvector`
2. PostgreSQL rows + Lucent-side fallback lexical retrieval first, vector later

Current recommendation:

- prefer `pgvector` if the local/prod ops cost is acceptable
- otherwise ship lexical/BM25-style bounded retrieval first and keep the table
  layout compatible with later vector columns

Do not decide this by aesthetics. Decide it by:

- local setup cost
- production deployment complexity
- repeatable import/index flow
- testability in CI/local development

### Phase 2: Import / Rebuild Pipeline

Extend the reproducible indexing path under Lucent-owned tooling.

New parser files to create:

- `scripts/import/medicine/parsers/cn_leaflets.py`
  - reads `ChineseDrugData_Master.xlsx` sheet `InstructionsClean`
  - emits rows for `cn_medicine_leaflets`
- `scripts/import/medicine/parsers/cn_product_leaflet_links.py`
  - reads `ChineseDrugData_Master.xlsx` sheet `ProductInstructionLinks`
  - emits rows for `cn_medicine_product_leaflet_links`

Update orchestration:

- `scripts/import/medicine/import-medicine-knowledge.ts`
  - register the two new commands under `COMMANDS`
  - add `cn-leaflets` and `cn-product-leaflet-links` to the default run order
- `scripts/import/medicine/import-medicine-datasets.ts`
  - ensure the new commands are included in `pnpm import:medicine:all`

Expected outputs:

- leaflet row extraction from `InstructionsClean`
- product-leaflet link extraction from `ProductInstructionLinks`
- chunk extraction from `cn_medicine_leaflets`
- embedding generation through `AI_EMBEDDING_*`
- idempotent re-index command
- import/index run metadata for:
  - source version
  - chunk count
  - failed rows
  - skipped rows

Likely command shape:

- `scripts/import/medicine/...`
- one dedicated command for rebuilding leaflet retrieval index

### Phase 3: Assistant Tool Surface

Add exactly one bounded retrieval tool, for example:

- `get_medicine_leaflet_context`

Tool responsibilities:

- resolve a medicine target from the user query or explicit assistant plan
- find the linked leaflet(s) through `cn_medicine_product_leaflet_links`
- retrieve top relevant chunks from indexed CN leaflet data
- return a server-owned envelope with:
  - target medicine metadata
  - linked leaflet metadata
  - selected chunks
  - source fields
  - retrieval score/rank metadata
  - coverage status
  - ambiguity notes

Tool must refuse when:

- no medicine can be matched with enough confidence
- no leaflet link exists for the matched product
- retrieval index is unavailable
- source coverage is empty

Refusal is better than pretending certainty.

### Phase 4: Assistant Runtime Wiring

Only after the tool works:

- add the new tool to assistant capability/policy wiring
- expose it in `ragEnabled` / tool capability truth only when executable
- update the assistant system prompt so the model knows:
  - retrieval evidence supports explanation
  - rule-engine safety conclusions remain authoritative
  - uncertainty and source limits must be stated plainly

### Phase 5: Validation + Safety QA

Minimum validation must include:

- target matching success cases
- empty/no-match refusal cases
- ambiguity cases with similar products
- retrieval result provenance assertions
- assistant capability truth when:
  - embedding config missing
  - index missing
  - retrieval enabled
- prompt-level/manual QA:
  - explanation becomes deeper
  - answer does not overclaim
  - answer does not override existing risk-engine conclusion wording

## Likely Affected Files

- `prisma/schema.prisma`
- new Prisma migration under `prisma/migrations/`
- `src/modules/assistant/**`
- `src/config/ai.config.ts`
- `src/config/environment.validation.ts`
- `scripts/import/medicine/import-medicine-knowledge.ts`
- `scripts/import/medicine/import-medicine-datasets.ts`
- `scripts/import/medicine/parsers/cn_leaflets.py` (new)
- `scripts/import/medicine/parsers/cn_product_leaflet_links.py` (new)
- `scripts/import/medicine/parsers/cn_products.py` (already updated for master)
- `docs/public/data-sources.md`
- `docs/public/assistant-contract.md`
- `docs/environment.md`
- `docs/TODO.md`

Possible new backend areas:

- `src/modules/assistant/tools/assistant-tool-leaflet-read.service.ts`
- `src/modules/assistant/retrieval/**`
- `scripts/import/medicine/rebuild-leaflet-index.ts`

## Data Model Sketch

This is a design direction, not locked schema.

```text
cn_medicine_leaflets
- id
- instruction_id           // stable id from InstructionsClean, e.g. YAOZS-000001
- source_file              // original yaozs workbook name
- source_row               // original row number
- title
- title_url
- number_raw
- summary
- generic_name
- brand_name
- pinyin
- approval_raw
- approval_codes           // extracted approval codes
- approval_conflict        // flag when 编号 and 批准文号 disagree
- drug_category
- manufacturer
- drug_nature
- related_diseases
- properties
- ingredients
- indications
- package_spec
- adverse_reactions
- dosage
- contraindications
- precautions
- pregnancy_lactation
- pediatric_use
- geriatric_use
- drug_interactions
- pharmacology_toxicology
- pharmacokinetics
- storage
- validity_period
- merge_notes
- created_at
- updated_at
```

```text
cn_medicine_product_leaflet_links
- id
- product_id               // cn_medicine_products.id
- leaflet_id               // cn_medicine_leaflets.id
- approval_code            // code used for the link
- match_score              // text similarity score
- is_best_match            // optional, true for the product's chosen leaflet
- created_at
- updated_at
```

```text
medicine_leaflet_chunks
- id
- source_kind              // cn
- leaflet_id               // cn_medicine_leaflets.id
- source_field             // contraindications, precautions, ...
- chunk_text
- chunk_index
- embedding                // if pgvector chosen
- token_count
- source_version
- source_hash
- created_at
- updated_at
```

Optional later table:

```text
medicine_leaflet_index_runs
- id
- source_name
- source_version
- chunk_count
- failed_count
- note
- created_at
```

## Retrieval Result Shape Direction

Keep a server-owned envelope similar to other assistant read tools.

Example direction:

```ts
{
  query: {
    medicineQuery: string,
    matchedSource: 'cn',
    matchedRecordId: string | null,
    matchedLeafletIds: string[],
    matchedBy: string[],
  },
  result: {
    medicine: {
      id: string,
      source: 'cn',
      name: string,
      manufacturer: string | null,
      approvalNumber: string | null,
    },
    leaflets: Array<{
      id: string,
      instructionId: string,
      genericName: string | null,
      manufacturer: string | null,
      approvalCodes: string[],
    }>,
    chunks: Array<{
      leafletId: string,
      field: string,
      text: string,
      rank: number,
      score: number | null,
    }>,
  },
  coverage: {
    status: 'complete' | 'partial' | 'empty',
    reason: string | null,
  },
  source: {
    tool: 'get_medicine_leaflet_context',
    generatedAt: string,
    tables: [
      'cn_medicine_products',
      'cn_medicine_leaflets',
      'cn_medicine_product_leaflet_links',
      'medicine_leaflet_chunks',
    ],
  },
  confidence: {
    level: 'high' | 'medium' | 'low',
    reason: string,
  },
  ambiguities: string[],
}
```

## Verification Plan

Backend validation:

- `pnpm typecheck`
- `pnpm test`
- focused assistant/retrieval specs
- focused import/index script tests
- `pnpm build`

If schema or API changes:

- `pnpm export:openapi`

If env/doc/import strategy changes:

- update `docs/environment.md`
- update `docs/public/data-sources.md`
- update `docs/public/assistant-contract.md`

## Observable Done

- A medicine question in assistant can use one bounded Lucent retrieval tool to
  quote relevant leaflet evidence in a safer, more specific explanation.
- `GET /api/v1/user/assistant/capabilities` can truthfully report whether RAG
  is enabled.
- No existing medicine safety verdict path depends on retrieval being present.
- Retrieval failure degrades to “not available / insufficient coverage”, not
  fake confidence.
- Leaflet data is imported from `InstructionsClean` and linked to products
  through `ProductInstructionLinks`, not silently merged into product columns
  for RAG.

## Exit Criteria Before Starting UI Work

The backend slice is ready to start only when these questions are answered in
implementation prep:

1. first index strategy: `pgvector` vs lexical-first
2. first indexed source: confirmed `cn` only, sourced from `cn_medicine_leaflets`
3. first tool name and envelope shape
4. first chunk field list
5. first local rebuild command
6. leaflet table schema and import path from `InstructionsClean`
7. product-leaflet link table schema and import path from `ProductInstructionLinks`

Until those are answered, “start RAG” is still too vague.
