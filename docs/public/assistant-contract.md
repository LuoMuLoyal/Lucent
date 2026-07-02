# Assistant Contract

Last updated: 2026-07-02

## Summary

This document describes the current backend-visible assistant contract that
Luminous can rely on.

Current scope:

- capability and permission discovery
- bounded SSE assistant replies
- persisted conversation restore / recent list / open / archive-current
- explicit separation between persisted conversations and optional cross-conversation memory
- proposal-only write intents that still require frontend human confirmation

Current non-goals:

- free-form tool calling with no server-owned limits
- autonomous writes
- broad conversation management such as rename or delete

## AI Architecture Boundary

The following boundaries constrain all future AI work:

| Scenario                               | Pattern                   | Rule                                                                                                    |
| -------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| Today / Report weekly / Monthly report | Bounded linear            | Facts → single structured-output generation; reuse locale-aware prompt/copy services                    |
| Assistant                              | Agent (LangGraph)         | Reserved for multi-turn conversation, tool-calling, branching, and retrieval                            |
| New AI features                        | Default to bounded linear | Escalate to agent only with a concrete tool-use or multi-step reasoning requirement                     |
| Shared generator/policy/service layer  | Reuse `common/ai`         | Today/Report already share `BaseAiGeneratorService`, `AiSafetyPolicyService`, and `BaseAiSummaryService |

All bounded-linear AI features must follow the layered architecture implemented in `src/common/ai`:

```
AI Analysis Flow
├── Context Layer (context.service.ts)    – data collection / context building
├── Copy Layer    (copy.service.ts)       – locale-aware prompt copy
├── Generator Layer (base-ai-generator.service.ts) – model call, structured/stream output
├── Policy Layer  (ai-safety-policy.service.ts)    – content safety checks
└── Service Layer (base-ai-summary.service.ts)     – orchestration, fallback, persistence
```

### Rules

- Do not copy-paste a new `PolicyService` or `GeneratorService`. Extend or reuse the shared base classes in `src/common/ai`.
- New AI analysis modules must implement the `BaseAiSummaryService` template unless they are agent-based.
- All AI output must pass the shared `AiSafetyPolicyService` before being returned or persisted.
- Streamed output must also be filtered by `AiSafetyPolicyService.isSafeSummaryText` for every intermediate chunk.
- When policy rejects output, fall back to the locale-aware `copyService.buildFallback()` result. Do not return empty output or throw.

Implications:

- Do not retro-fit Today/Report bounded linear flows into agent flows "for consistency".
- `ai-copy.ts` (locale-aware prompt/copy helpers) remains the shared prompt/copy layer; extend it with scenario-specific keys rather than replacing it.
- Assistant retrieval is source-split and server-owned. Chinese leaflet, DrugBank scientific passages, and filtered medical QA are separate retrieval tools with different trust boundaries. None of them replaces the reviewed medicine safety rule engine.

## AI Safety Policy

The shared `AiSafetyPolicyService` forbids content that could be interpreted as medical advice:

- Diagnosis, confirmed conditions, or treatment plans.
- Recommendations to start, stop, increase, decrease, or adjust medication dosage.
- Prescriptions or curing claims.

Forbidden patterns default to a hardcoded baseline. They can be overridden at runtime via the `AI_SAFETY_FORBIDDEN_PATTERNS` environment variable (comma- or newline-separated regex strings). If the variable is empty or unset, the default baseline is used.

Rules:

- AI output must never contain diagnosis, prescription, dosage adjustment, or treatment-plan wording.
- Every bounded-linear AI module must run policy checks on both final output and streamed intermediate summary text.
- Policy rejection must trigger the fallback copy path, not an empty/error response.
- Filtered medical QA retrieval is assistant-only reference material. It must not be treated as authoritative diagnosis, prescription, dosage, or treatment advice.

## AI Copy / Localization

All user-visible AI copy must flow through the shared localization layer rather than being hardcoded inline:

- Prompt system/user messages must be built through locale-aware copy services (`LocalizedCopyService` subclasses) and the shared `ai-copy.ts` helpers.
- Fallback copy returned on model failure or policy rejection must also be retrieved through `copyService.buildFallback()` in the active locale.
- Do not hardcode Chinese, English, or any other language strings in generator, policy, or service code except for immutable technical identifiers (e.g., tool names, enum keys).
- Frontend-facing AI messages must use the same locale keys and fallback semantics that the backend copy services produce; do not rephrase or retranslate them in the client.

## Public Routes

- `GET /api/v1/user/assistant/capabilities`
- `GET /api/v1/user/assistant/latest`
- `POST /api/v1/user/assistant/latest/clear`
- `GET /api/v1/user/assistant/conversations`
- `POST /api/v1/user/assistant/conversations/:conversationId/open`
- `POST /api/v1/user/assistant/messages/stream`

## Settings Contract

Assistant-related user settings now use assistant-facing API fields:

```ts
interface UserSettingsDto {
  assistantEnabled: boolean;
  assistantMemoryEnabled: boolean;
  assistantContext: {
    healthProfile: boolean;
    dailyRecords: boolean;
    sleepRecords: boolean;
    currentMedicines: boolean;
  };
}
```

Storage note:

- backend persistent setting keys now also use `assistant*` naming directly
- previous `aiChat*` compatibility keys are no longer read or written

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

## Conversation Contract

Latest / list / open all operate on persisted assistant conversations.

```ts
interface AssistantConversationDto {
  id: string;
  title: string | null;
  status: 'active' | 'archived';
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    usedTools: string[];
    createdAt: string;
  }>;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Behavior:

- `latest` returns the latest active conversation or `null`
- `latest/clear` archives the latest active conversation instead of deleting rows
- `open` promotes the selected conversation to active and archives the previous active one
- persisted assistant conversations are not the same thing as historical Today/Report AI summaries

## Streaming Contract

`POST /api/v1/user/assistant/messages/stream` uses SSE.

Request body:

```ts
interface StreamAssistantMessagesDto {
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}
```

Final result payload:

```ts
interface AssistantStreamResultDto {
  conversationId: string;
  role: 'assistant';
  content: string;
  usedTools: string[];
  generatedAt: string;
  proposedActions?: AssistantProposedActionDto[];
}
```

Rules:

- the last message must be a non-empty `user` message
- tool use stays server-owned and bounded
- the server may stream text chunks first and then emit one final `result`
- `proposedActions` never means the backend already wrote data
- assistant retrieval loops are bounded; the runtime may perform multiple retrieval decisions, but only within an explicit server cap

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

- `search_cn_medicine_products` returns bounded structured candidates from `cn_medicine_products` for Chinese-market product lookup.
- `get_cn_medicine_detail` returns one structured Chinese product detail when one product id or one safe single-candidate resolution is available; otherwise it returns explicit candidates instead of guessing.
- `get_drugbank_detail` returns one structured DrugBank detail when one DrugBank id or one safe single-candidate resolution is available; otherwise it returns explicit candidates instead of guessing.
- These tools stay server-owned and bounded. They must not be treated as proof that a Chinese product already maps to one DrugBank entity.

### Source-Split Retrieval Tools

#### Chinese leaflet retrieval

`search_medicine_leaflets` retrieves Chinese medicine package-insert evidence from a dedicated vector index over Lucent-owned leaflet chunks.

- It requires no specific context source to be permitted, but in practice the graph only selects it when `current_medicines` is enabled or the user explicitly asks about a medicine.
- Retrieval is vector-first and source-split. A miss stays a miss; the assistant must not fall back to keyword guessing.
- Product/entity ambiguity is surfaced as partial coverage with explicit candidates instead of silent guessing.
- Returned chunks are server-owned evidence; the model must not treat them as diagnosis or dosing instruction and must express uncertainty when the chunks do not answer the question.

#### Medical QA retrieval

`search_medical_qa_corpus` retrieves filtered semantic matches from the imported `alpaca_zh_demo`-derived medical QA corpus.

- This tool is assistant-only reference material and is never a frontend linear medication-flow evidence source.
- High-risk content is filtered/tagged before indexing; blocked rows must not be returned.
- Every response includes disclaimer context and must be presented as educational reference rather than authoritative care advice.

#### DrugBank retrieval

DrugBank retrieval is intentionally split into two tools:

- `resolve_drugbank_entity`
- `get_drugbank_detail`
- `search_drugbank_passages`

`resolve_drugbank_entity` identifies one or more bounded DrugBank entity candidates from local Lucent data. `get_drugbank_detail` reads one structured detail record when one safe candidate is available. `search_drugbank_passages` then searches only inside the resolved entity scope.

- DrugBank retrieval is entity-scoped, not open-ended whole-corpus passage search as the primary path.
- DrugBank passages are intended for scientific grounding such as mechanism, interactions, and narrative pharmacology context.
- If no resolved entity scope exists, the assistant must treat that as missing evidence instead of improvising a search target.

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
- `query.matchedBy` uses stable semantic tags such as `explicit_iso_date`, `relative_today`, `explicit_date_range`, and `relative_last_n_days` instead of echoing raw user text
- retrieval tools may also include source-specific tags such as resolved entity/product ids, retrieval method, cursor metadata, and metadata filters
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
- `expiresAt` marks proposal staleness; frontend should treat proposals as snapshots, not permanent write tickets
- update/delete proposals are intentionally withheld unless one record can be matched with high enough certainty

## Runtime Truth

- orchestration foundation is LangGraph
- streaming transport is SSE
- markdown output is expected
- retrieval is source-split across Chinese leaflets, filtered medical QA, and entity-scoped DrugBank passages
- assistant retrieval loops are bounded; runtime may decide to call zero, one, or multiple retrieval tools, but only inside explicit loop and tool-count caps
- persisted assistant conversations are live
- cross-conversation memory is optional and controlled by `assistantMemoryEnabled`
