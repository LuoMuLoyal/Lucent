# Assistant Capabilities

本文件是 [[assistant-contract]] 拆分后的子文档。

相关子文档：

- [[assistant-rollout]]
- [[assistant-safety]]

## Capability Shape

`GET /api/v1/user/assistant/capabilities` returns assistant-facing fields:

```ts
interface AssistantCapabilitiesDto {
  phase: 'foundation';
  assistantEnabled: boolean;
  assistantMemoryEnabled: boolean;
  assistantContext: {
    healthProfile: boolean;
    dailyRecords: boolean;
    sleepRecords: boolean;
    currentMedicines: boolean;
  };
  chatModelConfigured: boolean;
  interactiveChatReady: boolean;
  langGraphReady: boolean;
  streamingSupported: boolean;
  streamingTransport: 'sse';
  markdownRenderingRecommended: boolean;
  ragEnabled: boolean;
  tools: AssistantToolCapabilityDto[];
  updatedAt: string | null;
}
```

## Current Read Tools

- `get_today_records`
- `get_records_by_date`
- `get_records_by_range`
- `get_today_summary_by_date`
- `get_report_summary_by_range`
- `get_recent_today_summaries`
- `get_recent_report_summaries`
- `get_user_profile`
- `get_user_settings`
- `get_current_medicines`
- `get_sleep_summary_by_range`
- `search_cn_medicine_products`
- `get_cn_medicine_detail`
- `search_medicine_leaflets`
- `search_medical_qa_corpus`
- `resolve_drugbank_entity`
- `get_drugbank_detail`
- `search_drugbank_passages`

### Structured Medicine Lookup Tools

- `search_cn_medicine_products` returns bounded structured candidates from `cn_medicine_products`
  for Chinese-market product lookup.
- `get_cn_medicine_detail` returns one structured Chinese product detail when one product id or one
  safe single-candidate resolution is available; otherwise it returns explicit candidates instead of
  guessing.
- `get_drugbank_detail` returns one structured DrugBank detail when one DrugBank id or one safe
  single-candidate resolution is available; otherwise it returns explicit candidates instead of
  guessing.
- These tools stay server-owned and bounded. They must not be treated as proof that a Chinese
  product already maps to one DrugBank entity.

### Source-Split Retrieval Tools

#### Chinese leaflet retrieval

`search_medicine_leaflets` retrieves Chinese medicine package-insert evidence from a dedicated
vector index over Lucent-owned leaflet chunks.

- It requires no specific context source to be permitted, but in practice the graph only selects it
  when `current_medicines` is enabled or the user explicitly asks about a medicine.
- Retrieval is vector-first and source-split. A miss stays a miss; the assistant must not fall back
  to keyword guessing.
- Product/entity ambiguity is surfaced as partial coverage with explicit candidates instead of
  silent guessing.
- Returned chunks are server-owned evidence; the model must not treat them as diagnosis or dosing
  instruction and must express uncertainty when the chunks do not answer the question.

#### Medical QA retrieval

`search_medical_qa_corpus` retrieves filtered semantic matches from the imported
`alpaca_zh_demo`-derived medical QA corpus.

- This tool is assistant-only reference material and is never a frontend linear medication-flow
  evidence source.
- High-risk content is filtered/tagged before indexing; blocked rows must not be returned.
- Every response includes disclaimer context and must be presented as educational reference rather
  than authoritative care advice.

#### DrugBank retrieval

DrugBank retrieval is intentionally split into two tools:

- `resolve_drugbank_entity`
- `get_drugbank_detail`
- `search_drugbank_passages`

`resolve_drugbank_entity` identifies one or more bounded DrugBank entity candidates from local
Lucent data. `get_drugbank_detail` reads one structured detail record when one safe candidate is
available. `search_drugbank_passages` then searches only inside the resolved entity scope.

- DrugBank retrieval is entity-scoped, not open-ended whole-corpus passage search as the primary
  path.
- DrugBank passages are intended for scientific grounding such as mechanism, interactions, and
  narrative pharmacology context.
- If no resolved entity scope exists, the assistant must treat that as missing evidence instead of
  improvising a search target.

## Current Proposal-Only Write Tools

- `propose_create_daily_record`
- `propose_update_daily_record`
- `propose_delete_daily_record`
- `propose_update_user_settings`

Proposal rules:

- assistant may emit a structured proposal
- frontend must render it as confirmable UI
- confirm path must route back into existing product write flows
- assistant itself is not allowed to write the database directly through this contract

## Read Result Envelope

Current read tools now return a consistent server-owned envelope before the model sees them:

```ts
interface AssistantReadResultEnvelope {
  query: Record<string, unknown>;
  result: Record<string, unknown>;
  coverage: {
    status: 'complete' | 'partial' | 'empty';
    reason: string | null;
    omittedContextSources?: Array<
      'health_profile' | 'daily_records' | 'sleep_records' | 'current_medicines'
    >;
    omittedKinds?: string[];
  };
  timeRange: {
    timezone: 'UTC';
    startDate: string | null;
    endDate: string | null;
  };
  source: {
    tool: AssistantToolName;
    generatedAt: string;
    tables: string[];
  };
  confidence: {
    level: 'high' | 'medium' | 'low';
    reason: string;
  };
  ambiguities: string[];
}
```

Rules:

- `query` records the exact resolved date/range/profile scope the server used
- `query.matchedBy` uses stable semantic tags such as `explicit_iso_date`, `relative_today`,
  `explicit_date_range`, and `relative_last_n_days` instead of echoing raw user text
- retrieval tools may also include source-specific tags such as resolved entity/product ids,
  retrieval method, cursor metadata, and metadata filters
- `coverage` must say whether the answer is complete, partial, or empty
- `ambiguities` must surface defaulted dates/ranges instead of silently hiding them
- range reads stay bounded; current record/sleep range tools cap at 14 days
- mutation-target matching is allowed to refuse proposal generation instead of guessing

## Proposal Shape

Current assistant proposals now carry explicit target and constraint metadata:

```ts
interface AssistantProposedActionDto {
  id: string;
  type:
    | 'create_daily_record'
    | 'update_daily_record'
    | 'delete_daily_record'
    | 'update_user_settings';
  status: 'proposed';
  confirmationRequired: true;
  title: string;
  summary: string;
  reason: string | null;
  previewFields: Array<{ label: string; value: string }>;
  target: {
    kind: 'daily_record' | 'daily_record_draft' | 'user_settings';
    label: string;
    recordId?: string;
    settingKeys?: string[];
    matchedBy?: string[];
    snapshot?: Record<string, unknown>;
  };
  constraints: string[];
  expiresAt: string;
  payloadVersion: 1;
  payload: unknown;
}
```

Additional rules:

- `target` identifies exactly what the proposal is about
- `constraints` is user-facing guardrail text for confirmation UI
- `expiresAt` marks proposal staleness; frontend should treat proposals as snapshots, not permanent
  write tickets
- update/delete proposals are intentionally withheld unless one record can be matched with high
  enough certainty
