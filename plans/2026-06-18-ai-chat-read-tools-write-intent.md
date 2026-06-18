# AI Chat Read Tools + Write Intent

Last updated: 2026-06-18

## Goal

Define and implement the next bounded Lucent AI chat slice after Phase 1:

- expand the read-only tool inventory so the assistant can answer with better
  user-scoped facts
- introduce structured `propose_*` write intents instead of direct AI writes
- keep all real writes behind explicit frontend confirmation

This phase is still about control first. It is not a free-form autonomous agent
phase.

## Assumptions

- The current SSE chat route remains the primary transport.
- LangGraph remains server-side orchestration only.
- Existing user settings and daily-record APIs remain the execution path for
  confirmed writes; AI chat does not get a parallel direct-write backend route
  in the first write-intent slice.
- The current `note` daily-record kind is the correct backend storage fallback
  for user-defined custom records. Do not add a second parallel custom kind.
- Mood is useful, but it is not the priority of this slice. Keep a reserved
  hook for it without letting it expand the scope now.

## Likely Files

- `src/modules/ai-chat/tools/ai-chat-tool.types.ts`
- `src/modules/ai-chat/tools/ai-chat-tool.executor.ts`
- `src/modules/ai-chat/tools/ai-chat-tool-context.service.ts`
- `src/modules/ai-chat/agent/ai-chat-agent.graph.ts`
- `src/modules/ai-chat/ai-chat.service.ts`
- `src/modules/ai-chat/dto/*`
- `src/modules/daily-records/**`
- `src/modules/user-settings/**`
- `test/**/ai-chat*`
- `docs/public/ai-chat-contract.md`

## Phase Breakdown

### Phase A: Read Tools

Add a larger but still bounded read-only inventory:

- `get_today_records`
- `get_records_by_date`
- `get_records_by_range`
- `get_recent_today_summaries`
- `get_recent_report_summaries`
- `get_user_profile`
- `get_user_settings`
- `get_current_medicines`
- `get_sleep_summary_by_range`

Phase A correction after product clarification:

- “历史 AI” means persisted Today/Report AI summaries, not assistant chat logs
- assistant conversation history is a separate persistence surface
- cross-conversation assistant memory must stay user-controllable through a
  dedicated settings toggle instead of being silently inferred from chat
  persistence

Not part of the first implementation even if reserved in docs:

- mood-focused tools

### Phase B: Write Intent

Add proposal-only write tools:

- `propose_create_daily_record`
- `propose_update_daily_record`
- `propose_delete_daily_record`
- `propose_update_user_settings`

Rules:

- tool output must be structured
- tool output must be confirmable by the frontend
- tool output must not mutate data by itself
- every proposal must map cleanly to an existing backend write path

### Phase C: Record UX Handshake

Backend contract support for the later Record-page UX upgrade:

- quick-capture friendly daily-record payloads
- current-time defaults when the user confirms a quick insert
- `note` exposed product-wise as “custom”
- reserved mood entry point, but no broad mood workflow in this phase

## Milestones

1. Define the target read-tool inventory and response shapes in docs
2. Add tool-capability truth for the new inventory without lying about
   implementation state
3. Define `proposedActions` result payload contract for SSE final results
4. Implement read-only tools behind user permission checks
5. Implement proposal-only tools that emit structured pending actions
6. Keep real writes in existing confirmed frontend/API flows

## Validation

- `pnpm typecheck`
- `pnpm build`
- focused Jest tests for:
  - tool permission gating
  - date/range validation
  - proposal payload shape
  - proposal non-mutation behavior

## Expected Observable Outcome

- the assistant can answer factual questions about today, one date, a date
  range, profile/settings, current medicines, sleep ranges, and historical
  Today/Report AI summaries using explicit tools
- the assistant can suggest writes as structured proposals
- the frontend has enough data to render confirmation cards without inventing
  business logic
- no AI-generated write bypass exists
