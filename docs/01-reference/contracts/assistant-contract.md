---
status: active
owner: backend
quadrant: reference
updated: 2026-08-17
---

# Assistant Contract

本文档保留助手合同总览与边界。

子文档：

- [[assistant-capabilities]]
- [[assistant-rollout]]
- [[assistant-safety]]

## Summary

This document describes the current backend-visible assistant contract that
Luminous can rely on.

Current scope:

- capability and permission discovery
- bounded SSE assistant replies
- persisted conversation restore / recent list / open / archive-current
- explicit separation between persisted conversations and optional cross-conversation memory
- proposal-only write intents that still require frontend human confirmation
- persisted Today Analysis reads and explicit, cooldown-protected refreshes

Current non-goals:

- free-form tool calling with no server-owned limits
- autonomous writes
- broad conversation management such as rename or delete

## AI Architecture Boundary

The following boundaries constrain all future AI work:

- **Today / Report weekly / Monthly report** → `Bounded linear` — Facts → single structured-output
  generation; reuse locale-aware prompt/copy services
- **Assistant** → `Agent (LangGraph)` — Reserved for multi-turn conversation, tool-calling,
  branching, and retrieval
- **New AI features** → `Default to bounded linear` — Escalate to agent only with a concrete
  tool-use or multi-step reasoning requirement
- **Shared generator/policy/service layer** → `Reuse `common/llm``— Today/Report already share`BaseLlmGeneratorService`, `LlmSafetyPolicyService`, and `BaseLlmSummaryService

All bounded-linear AI features must follow the layered architecture implemented in `src/common/llm`:

```
AI Analysis Flow
├── Context Layer (context.service.ts)    – data collection / context building
├── Copy Layer    (copy.service.ts)       – locale-aware prompt copy
├── Generator Layer (base-ai-generator.service.ts) – model call, structured/stream output
├── Policy Layer  (ai-safety-policy.service.ts)    – content safety checks
└── Service Layer (base-ai-summary.service.ts)     – orchestration, fallback, persistence
```

### Rules

- Do not copy-paste a new `PolicyService` or `GeneratorService`. Extend or reuse the shared base
  classes in `src/common/llm`.
- New AI analysis modules must implement the `BaseLlmSummaryService` template unless they are
  agent-based.
- All AI output must pass the shared `LlmSafetyPolicyService` before being returned or persisted.
- Streamed output must also be filtered by `LlmSafetyPolicyService.isSafeSummaryText` for every
  intermediate chunk.
- When policy rejects output, fall back to the locale-aware `copyService.buildFallback()` result. Do
  not return empty output or throw.

Implications:

- Do not retro-fit Today/Report bounded linear flows into agent flows "for consistency".
- `ai-copy.ts` (locale-aware prompt/copy helpers) remains the shared prompt/copy layer; extend it
  with scenario-specific keys rather than replacing it.
- Assistant retrieval is source-split and server-owned. Chinese leaflet, DrugBank scientific
  passages, and filtered medical QA are separate retrieval tools with different trust boundaries.
  None of them replaces the reviewed medicine safety rule engine.

Today Analysis is a bounded, materialized read model. `GET /api/v1/user/today-analysis` reads the
latest persisted result and returns `empty`, `pending`, `ready`, `stale`, or `failed`; it never
starts the LLM pipeline. `POST /api/v1/user/today-analysis/refresh` is the explicit refresh path,
with a five-minute per-user/date cooldown and a three-generation daily cap. Server-side health
event, symptom record, dose-log, and eligible suggestion-materialization events enqueue versioned
jobs; ordinary food, mood, water, and note records do not.

Today Analysis context types may carry the shared sparse `ObservedMetric<T>` shape. Consumers must
keep `unknown` distinct from an observed zero and must not turn a missing water value into a
zero-valued fact before generation.

The OpenAPI DTOs for Today Analysis expose the same observed metric boundary used by Report and
Today Suggestions: nullable `value` and `expectedCount` remain explicit fields, while `state`,
`coverage`, and `sources` explain whether a generated fact is usable. Assistant/analysis prompts
must preserve that distinction and never infer zero from an absent observation.

## AI Copy / Localization

All user-visible AI copy must flow through the shared localization layer rather than being hardcoded
inline:

- Prompt system/user messages must be built through locale-aware copy services
  (`LocalizedCopyService` subclasses) and the shared `ai-copy.ts` helpers.
- Fallback copy returned on model failure or policy rejection must also be retrieved through
  `copyService.buildFallback()` in the active locale.
- Do not hardcode Chinese, English, or any other language strings in generator, policy, or service
  code except for immutable technical identifiers (e.g., tool names, enum keys).
- Frontend-facing AI messages must use the same locale keys and fallback semantics that the backend
  copy services produce; do not rephrase or retranslate them in the client.

## Public Routes

- `GET /api/v1/user/assistant/capabilities`
- `GET /api/v1/user/assistant/latest`
- `POST /api/v1/user/assistant/latest/clear`
- `GET /api/v1/user/assistant/conversations`
- `POST /api/v1/user/assistant/conversations/:conversationId/open`
- `PATCH /api/v1/user/assistant/conversations/:conversationId` — rename a conversation (body `{ title }`, non-empty, ≤ 48 chars); returns the updated conversation
- `DELETE /api/v1/user/assistant/conversations/:conversationId` — soft-delete a conversation (`status = deleted`); returns the deleted conversation
- `POST /api/v1/user/assistant/conversations/:conversationId/confirm`
- `POST /api/v1/user/assistant/messages/stream`
- `GET /api/v1/user/today-analysis`
- `POST /api/v1/user/today-analysis/refresh`

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

## Conversation Contract

Latest / list / open all operate on persisted assistant conversations.

```ts
interface AssistantConversationDto {
  id: string;
  title: string | null;
  status: 'active' | 'archived' | 'deleted';
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
- `PATCH conversations/:id` renames a non-deleted conversation (title only); deleted conversations are treated as not found (404)
- `DELETE conversations/:id` soft-deletes a conversation (status `deleted`); list/latest/open all exclude deleted conversations, and operating on an already-deleted conversation returns 404
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
  conversationId?: string;
}
```

When `conversationId` is present the turn runs on the persisted LangGraph thread
(checkpointed, with in-graph proposal review); when absent it stays stateless.

## Regeneration Contract

`POST /api/v1/user/assistant/conversations/:conversationId/regenerate` (SSE)
regenerates the last assistant message of a persisted conversation using
LangGraph time travel: the thread is forked from the recorded checkpoint right
before the `respond` node and that node re-streams a fresh answer. The old
answer stays in the conversation as a revision; the new answer is persisted as
a new assistant message.

SSE events match the streaming contract (`chunk` → `result` → `done`, or
`error`). The `result` payload is the same `AssistantMessageDataDto` shape
(`conversationId`, `role: 'assistant'`, `content`, `generatedAt`, `usedTools`,
`proposedActions`, `toolDetails`); regenerated answers carry empty
`usedTools`/`proposedActions`/`toolDetails` because only the `respond` node is
replayed, never the tool loop.

Rules:

- only the last persisted assistant message of the conversation can be
  regenerated; anything else returns 400
- the checkpoint must be locatable and its assistant text must equal the
  persisted message text (message 定位), otherwise 400
- duplicate regenerations of the same source message within 30 seconds return
  409 (idempotency window), backed by the `assistant_regenerations` table
- a missing/deleted conversation returns 404
- `simple_chat` turns (whose thread never holds an assistant message) and
  turns that ended with a guidance message appended are not regenerable in v1

## Confirm Contract

`POST /api/v1/user/assistant/conversations/:conversationId/confirm` approves or
rejects the pending write proposals of a suspended thread and resumes it.

```ts
interface ConfirmAssistantProposalDto {
  proposalIds: string[];
  decision: 'approved' | 'rejected';
  note?: string;
}

interface AssistantConfirmResultDto {
  conversationId: string;
  decision: 'approved' | 'rejected';
  status: 'approved' | 'rejected';
  finalContent: string | null;
}
```

Rules:

- the thread must have a `pending` review; confirming twice or an unknown
  conversation id is rejected
- an expired review is rejected and must be regenerated
- on `approved` the server applies the approved writes atomically from the
  thread proposals before resuming; on `rejected` nothing is written

Final result payload:

```ts
interface AssistantStreamResultDto {
  conversationId: string;
  role: 'assistant';
  content: string;
  usedTools: string[];
  generatedAt: string;
  proposedActions?: AssistantProposedActionDto[];
  toolDetails?: AssistantToolDetailDto[];
}
```

`toolDetails` is an optional, backward-compatible extension of the `result`
event (F-7 source strip): one entry per executed tool, carrying only fields
that exist in the tool result envelope. It is **not persisted** server-side,
so messages loaded from history never include it. Shape:

```ts
interface AssistantToolDetailDto {
  name: string; // matches an entry in usedTools
  label?: string | null; // display subject, e.g. resolved product name
  coverage?: {
    status: 'complete' | 'partial' | 'empty';
    reason: string | null;
  } | null;
  confidence?: { level: 'high' | 'medium' | 'low'; reason: string } | null;
  ambiguities?: string[];
  source?: { tool: string; generatedAt: string; tables: string[] } | null;
  disclaimer?: string | null; // medical knowledge disclaimer, when the tool emits one
}
```

Rules:

- the last message must be a non-empty `user` message
- tool use stays server-owned and bounded
- the server may stream text chunks first and then emit one final `result`
- normal model-backed replies are forwarded from the LangGraph agent/respond
  nodes as `model.stream()` text deltas while the graph invocation is still
  running; the graph remains the owner of tool-loop and checkpoint state
- cache hits and other pre-generated replies use the same SSE shape with a
  server-side chunking fallback, so clients do not need a second response path
- the stream uses `chunk` events with `{ content }`, one `result` event with the
  complete `AssistantStreamResultDto`, and a terminal `done` event with `{}`
- failures use an `error` event with `{ message }`; clients must not treat a
  partial chunk sequence as the persisted final result until `result` arrives
- transport-layer failures while forwarding a text delta (e.g. SSE client
  disconnect, broken pipe) are isolated from stream aggregation: the runtime
  continues collecting the final message and still emits the `result` event,
  so a single network hiccup does not turn a stream into a 500. Programming
  errors (TypeError etc.) and business logic errors thrown by the `onText`
  callback are **not** swallowed — they propagate to terminate the stream
- `proposedActions` never means the backend already wrote data
- assistant retrieval loops are bounded; the runtime may perform multiple retrieval decisions, but
  only within an explicit server cap
