# Assistant Contract

Last updated: 2026-06-25

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

- free-form tool calling
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
- `get_medicine_leaflet_context` is the first RAG read tool. It retrieves Chinese drug leaflets as server-owned text chunks. It is not a replacement for the reviewed medicine safety rule engine and not a mandatory dependency for every assistant reply.

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
- `get_medicine_leaflet_context`

### Medicine leaflet context

`get_medicine_leaflet_context` resolves the user's medicine mention against the local `cn_medicine_products` table, follows `cn_medicine_product_leaflet_links` to `cn_medicine_leaflets`, and returns up to 50 text chunks from `medicine_leaflet_chunks`.

- It requires no specific context source to be permitted, but in practice the graph only selects it when `current_medicines` is enabled or the user explicitly asks about a medicine.
- If multiple products match, the tool returns partial coverage with a candidate list instead of guessing.
- The returned chunks are server-owned evidence; the model must not treat them as a diagnosis or dosing instruction and must express uncertainty when the chunks do not answer the question.

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
- RAG is enabled when `medicine_leaflet_chunks` is populated and the chat model is configured
- persisted assistant conversations are live
- cross-conversation memory is optional and controlled by `assistantMemoryEnabled`
