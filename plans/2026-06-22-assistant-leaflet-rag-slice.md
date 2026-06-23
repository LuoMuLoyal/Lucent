# Goal

Define the first bounded Lucent RAG slice for medicine-leaflet retrieval as an
**assistant-only extra tool**, without turning retrieval into the primary
medicine-safety architecture.

This plan exists so the next backend step is executable after the user finishes
the upcoming UI/UX pass in Luminous.

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

## Assumptions

- This is a judgment: the highest-value first use of RAG is assistant
  explanation depth for medicine questions, not direct medicine page rendering.
- Existing source tables are already enough for a first retrieval slice:
  `cn_medicine_products` for package-insert text, plus optional later
  DrugBank-backed scientific enrichment.
- Embedding role config already exists in Lucent env/config and should be
  reused instead of introducing a second embedding configuration path.

## Phase Boundary

Start with **CN leaflet retrieval first**.

Reason:

- Lucent already stores long-form insert fields in `cn_medicine_products`.
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
  - which text chunks were retrieved
  - why those chunks were selected
  - what coverage/ambiguity remains
- keep `ragEnabled` false until the full minimum slice is actually wired

### Phase 1: Data + Index Design

Decide the first durable storage/index approach.

Preferred starting direction:

- add a dedicated Lucent-owned knowledge table for normalized leaflet chunks
- chunk only reviewed CN insert fields such as:
  - `indications`
  - `dosage`
  - `contraindications`
  - `precautions`
  - `pediatric_use`
  - `geriatric_use`
  - `pregnancy_lactation`
  - `adverse_reactions`
  - `drug_interactions`
- keep chunk metadata explicit:
  - source kind
  - source record id
  - field name
  - chunk index
  - import version/hash

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

Add a reproducible indexing path under Lucent-owned tooling.

Expected outputs:

- chunk extraction from `cn_medicine_products`
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
- retrieve top relevant chunks from indexed CN leaflet data
- return a server-owned envelope with:
  - target medicine metadata
  - selected chunks
  - source fields
  - retrieval score/rank metadata
  - coverage status
  - ambiguity notes

Tool must refuse when:

- no medicine can be matched with enough confidence
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
- `scripts/import/medicine/**`
- `docs/public/data-sources.md`
- `docs/public/assistant-contract.md`
- `docs/environment.md`
- `docs/TODO.md`

Possible new backend areas:

- `src/modules/assistant/tools/assistant-tool-leaflet-read.service.ts`
- `src/modules/assistant/retrieval/**`
- `scripts/import/medicine/rebuild-leaflet-index.ts`

## Data Model Sketch

This is a design direction, not locked schema:

```text
medicine_leaflet_chunks
- id
- source_kind              // cn
- source_record_id         // cn_medicine_products.id
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
    chunks: Array<{
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
    tables: ['cn_medicine_products', 'medicine_leaflet_chunks'],
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

## Exit Criteria Before Starting UI Work

The backend slice is ready to start only when these questions are answered in
implementation prep:

1. first index strategy: `pgvector` vs lexical-first
2. first indexed source: confirmed `cn` only
3. first tool name and envelope shape
4. first chunk field list
5. first local rebuild command

Until those are answered, “start RAG” is still too vague.
