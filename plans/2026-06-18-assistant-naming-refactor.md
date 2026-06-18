# Assistant Naming Refactor

## Goal

Rename the current `ai-chat` backend surface to `assistant` terminology across
Lucent source, routes, DTO names, tests, and docs so the codebase reflects the
real product boundary: assistant workspace, conversation persistence, runtime
tools, proposals, and optional memory.

## Non-Goals

- Do not change database physical table names or existing migration SQL names in
  this refactor.
- Do not rename deployed environment variables such as `AI_CHAT_MODEL` in this
  refactor.
- Do not mix feature logic changes with the naming work unless required to keep
  compilation/tests passing.

## Mapping Baseline

- `ai-chat` -> `assistant`
- `AiChat` -> `Assistant`
- `ai_chat` -> `assistant`
- `foundation` runtime naming:
  - `AiChatFoundationCapabilities` -> `AssistantRuntimeCapabilities`
  - `AiChatFoundationState` -> `AssistantRuntimeState`
  - `buildAiChatFoundationGraph` -> `buildAssistantRuntimeGraph`
  - `AI_CHAT_FOUNDATION_NODE_NAMES` -> `ASSISTANT_RUNTIME_NODE_NAMES`
- semantic cleanup:
  - `AiChatAgentService` -> `AssistantRuntimeService`
  - `AiChatToolExecutor` -> `AssistantToolService`
  - `AiChatToolContextService` -> `AssistantContextService`
  - `AiSummaryHistoryService` -> `HistoricalAiSummaryService`
  - `buildMemoryBlock` -> `buildPersistentMemoryBlock`

## Likely Affected Files

- `src/modules/ai-chat/**`
- `src/app.module.ts`
- `docs/public/ai-chat-contract.md`
- `docs/README.md`
- `docs/openapi.json`
- tests and specs referencing `ai-chat`

## Validation

- `pnpm test -- --runInBand src/modules/assistant/agent/assistant-runtime.graph.spec.ts src/modules/assistant/agent/assistant-runtime.service.spec.ts src/modules/assistant/assistant-policy.service.spec.ts src/modules/assistant/assistant.service.spec.ts src/modules/assistant/assistant.controller.spec.ts src/modules/assistant/tools/assistant-tool.service.spec.ts`
- `pnpm build`
- `pnpm export:openapi`

## Expected Observable Result

- Backend route contract moves from `/api/v1/user/ai-chat/*` to
  `/api/v1/user/assistant/*`.
- Source tree and public docs use `assistant` terminology instead of
  misleading `ai-chat`.
- Runtime names stop implying “foundation only” when they already represent the
  active assistant runtime boundary.
