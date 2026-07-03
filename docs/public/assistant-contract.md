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
- **Shared generator/policy/service layer** → `Reuse `common/ai``— Today/Report already share`BaseAiGeneratorService`, `AiSafetyPolicyService`, and `BaseAiSummaryService

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

- Do not copy-paste a new `PolicyService` or `GeneratorService`. Extend or reuse the shared base
  classes in `src/common/ai`.
- New AI analysis modules must implement the `BaseAiSummaryService` template unless they are
  agent-based.
- All AI output must pass the shared `AiSafetyPolicyService` before being returned or persisted.
- Streamed output must also be filtered by `AiSafetyPolicyService.isSafeSummaryText` for every
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
- assistant retrieval loops are bounded; the runtime may perform multiple retrieval decisions, but
  only within an explicit server cap
