# Assistant SSE Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three Lucent SSE endpoints deliver model output incrementally, with Assistant graph nodes streaming model text instead of generating a complete reply with `model.invoke()` and slicing it afterward.

**Architecture:** Keep LangGraph `graph.invoke()` for the tool loop, checkpoint/HITL state machine, and final state assembly. Replace the LLM calls in the Assistant SSE path with a shared `model.stream()` collector that forwards text deltas while returning an aggregated `AIMessage` for tool-call routing. Keep Today Analysis and Reports on their existing structured `model.stream()` implementation and verify those paths.

**Tech Stack:** NestJS 11, LangChain Core 1.1, LangGraph 1.4, Fastify raw SSE, Vitest, TypeScript.

---

### Task 1: Add failing Assistant streaming tests

**Files:**

- Create: `src/modules/assistant/agent/runtime/nodes.spec.ts`
- Modify: `src/modules/assistant/agent/runtime/respond.spec.ts`
- Modify: `src/modules/assistant/agent/runtime.service.spec.ts`

- [x] **Step 1: Write failing tests.** Use two delayed `AIMessageChunk` values; assert the callback receives both text deltas, the final text is complete, and `invoke` is never called for both the agent and respond nodes.
- [x] **Step 2: Run the tests and verify RED.**

```powershell
pnpm test -- src/modules/assistant/agent/runtime/nodes.spec.ts src/modules/assistant/agent/runtime/respond.spec.ts src/modules/assistant/agent/runtime.service.spec.ts
```

Expected: the new assertions fail because the current nodes call `model.invoke()` and have no live-text callback.

### Task 2: Implement streaming inside Assistant graph nodes

**Files:**

- Create: `src/modules/assistant/agent/runtime/model-stream.ts`
- Create: `src/modules/assistant/agent/runtime/model-stream.spec.ts`
- Modify: `src/modules/assistant/agent/runtime/nodes.ts`
- Modify: `src/modules/assistant/agent/runtime/respond.ts`
- Modify: `src/modules/assistant/agent/runtime/graph.ts`
- Modify: `src/modules/assistant/agent/runtime/subgraphs/read.ts`
- Modify: `src/modules/assistant/agent/runtime/subgraphs/write.ts`
- Modify: `src/modules/assistant/agent/runtime/subgraphs/knowledge.ts`

- [x] **Step 1: Test the collector first.** The helper accepts a streamable model, messages, and an optional text callback; it forwards non-empty text deltas immediately, aggregates all `AIMessageChunk` values, preserves assembled tool calls, and rejects an empty/non-AI stream.
- [x] **Step 2: Run the helper test and verify RED.**

```powershell
pnpm test -- src/modules/assistant/agent/runtime/model-stream.spec.ts
```

Expected: FAIL because the helper does not exist.

- [x] **Step 3: Implement the minimal collector.** Return an `AIMessage` from the aggregated chunks. Do not call `invoke()`.
- [x] **Step 4: Wire the collector into `createAgentNode` and `buildRespondNode`.** Add an optional `onText` callback; preserve existing tool-call routing, response caching, and empty-content validation.
- [x] **Step 5: Propagate `onText` through `AssistantGraphDeps` and all three subgraph dependency types.** Keep `graph.invoke()`; changing the graph runner alone cannot create token-level output while node models call `invoke()`.
- [x] **Step 6: Run focused runtime tests and verify GREEN.**

```powershell
pnpm test -- src/modules/assistant/agent/runtime src/modules/assistant/agent/runtime.service.spec.ts
```

### Task 3: Connect graph deltas to Assistant SSE without duplicates

**Files:**

- Modify: `src/modules/assistant/agent/runtime.service.ts`
- Modify: `src/modules/assistant/services/core.service.ts`
- Modify: `src/modules/assistant/services/core.service.spec.ts`
- Modify: `src/modules/assistant/agent/runtime.service.spec.ts`

- [x] **Step 1: Add a failing duplicate-prevention test.** Make `runConversation()` emit a live delta and return the same final content; assert `streamMessages()` sends it once and does not call `streamPreGeneratedContent()`. Add a cache-hit case that still uses the fallback when no live delta was emitted.
- [x] **Step 2: Run the focused test and verify RED.**

```powershell
pnpm test -- src/modules/assistant/services/core.service.spec.ts
```

Expected: FAIL because the current service always slices non-null graph content after the graph returns.

- [x] **Step 3: Implement runtime forwarding.** Let `runConversation()` accept an optional callback, pass a wrapper into `buildAssistantRuntimeGraph`, await the HTTP callback, track whether live text was emitted, and return that flag with the mapped result.
- [x] **Step 4: Implement service duplicate prevention.** Pass the callback into `runConversation()`; use the graph result directly when live text was emitted, and keep word-level fallback only for cached/pre-generated content.
- [x] **Step 5: Run focused Assistant tests.**

```powershell
pnpm test -- src/modules/assistant/agent/runtime.service.spec.ts src/modules/assistant/services/core.service.spec.ts src/modules/assistant/assistant.controller.spec.ts
```

Expected: PASS with one chunk sequence per Assistant response.

### Task 4: Verify all three SSE endpoints and update required docs

**Files:**

- Modify: `docs/02-logs/migration-log/2026-08-02.md`
- Modify only if coverage is missing: existing Today Analysis/Reports stream specs

- [x] **Step 1: Run structured-stream tests.**

```powershell
pnpm test -- src/common/llm/base-llm-generator.service.spec.ts src/common/llm/base-llm-summary.service.spec.ts src/modules/today-analysis/services/analysis.service.spec.ts src/modules/reports/services/ai-summary/summary.service.ts
```

Expected: the existing generator mocks prove Today Analysis and Reports use `model.stream()`.

- [x] **Step 2: Verify the route inventory.**

```powershell
rg -n --glob '*.ts' "text/event-stream|@Post\('.*stream|@Sse" src/modules
```

Expected: exactly Assistant messages, Today Analysis generate, and Reports summary generate; no fourth SSE controller endpoint exists.

- [x] **Step 3: Append a dated migration-log section.** Record the Assistant node streaming change, the preserved fallback, and verification of the other two SSE paths without overwriting existing sections.
- [x] **Step 4: Run `pnpm docs:check`.**

### Task 5: Verify without committing

- [x] **Step 1: Run formatting and lint.**

```powershell
pnpm format:check
pnpm lint:check
```

- [x] **Step 2: Run typecheck and build.**

```powershell
pnpm typecheck
pnpm build
```

- [x] **Step 3: Run the full unit suite.**

```powershell
pnpm test:ci
```

- [x] **Step 4: Inspect the final diff and state.**

```powershell
git diff --check
git diff --stat
git status --short --branch
```

Expected: no whitespace errors, only the streaming fix/tests/required migration log plus the uncommitted local plan, and no commit or push.
