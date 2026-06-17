# AI Chat Phase 1

Last updated: 2026-06-17

## Goal

Build the backend-first foundation for a lightweight AI chat feature that can:

- stream responses
- use a restricted server-side tool inventory
- respect explicit user context permissions
- stay inside Luminous/Lucent safety boundaries

This phase is about control and structure first, not about broad intelligence.

## Scope

Do:

- add a dedicated `ai-chat` backend module
- install and prove the LangGraph orchestration foundation
- define the initial tool inventory and graph skeleton
- keep the graph server-side and permission-aware by design
- prepare the frontend plan around streaming markdown chat

Do not:

- ship leaflet RAG yet
- add pgvector yet
- add long-term chat memory yet
- let the model freely choose from undeclared tools
- let AI produce medicine-risk judgments outside reviewed rules
- couple the first UI implementation to Firebase-oriented AI SDK assumptions

## Phase 1 Tool Boundary

Initial tool family for the restricted agent:

- `health_context_snapshot`
- `recent_daily_records`
- `recent_sleep_summary`
- `current_medicines`

RAG over medicine leaflets is explicitly a later tool, not part of the first contract.

## Assumptions

- Existing Today/Report AI service layering is still the right reference shape:
  - use-case service
  - copy/prompt service
  - policy service
  - generator/orchestrator service
  - `llm-runtime` for provider/model construction only
- The current `chat` model role in Lucent env config is the right model slot for user chat.
- User settings are still too coarse for chat permissions and must be expanded before real chat is exposed.

## Planned Backend Structure

```text
src/modules/ai-chat/
  agent/
  prompts/
  schemas/
  tools/
  ai-chat.module.ts
  ai-chat.service.ts
  ai-chat.types.ts
```

Notes:

- `agent/` owns LangGraph wiring and orchestration-only code
- `tools/` owns server-side tool inventory and permission mapping
- `schemas/` owns chat message / structured IO schemas
- `prompts/` owns system-level chat prompt boundaries

## Milestones

1. Land backend module skeleton and LangGraph dependency
2. Expand user settings contract for chat-context permissions
3. Add authenticated chat streaming contract
4. Add a server-controlled pre-generation tool execution layer
5. Wire first mobile chat page with bounded markdown streaming
6. Add RAG as a later extra tool only after the base loop is stable

## Validation

- `pnpm typecheck`
- `pnpm build`
- focused Jest coverage for new `ai-chat` services/graph

## Done Signal For This Foundation Step

- Lucent has a real `ai-chat` module instead of scattered future notes
- LangGraph is installed and used by a compilable foundation graph
- the first tool inventory is explicit in code
- the stream route can inject a server-approved subset of user-context tools
- docs clearly say “restricted tool chat first, RAG later”

## Current Status

- `GET /capabilities` is real
- `POST /messages/stream` is real
- user settings permissions gate tool eligibility
- LangGraph currently decides:
  - which tools are allowed in principle from enabled context sources
  - which tools are relevant enough to a user message to pre-run
- Lucent now pre-runs a bounded server-approved subset before generation:
  - `health_context_snapshot`
  - `recent_daily_records`
  - `recent_sleep_summary`
  - `current_medicines`
- tool results are injected into the prompt as factual context
- the model still does **not** run a free-form multi-step tool loop yet
