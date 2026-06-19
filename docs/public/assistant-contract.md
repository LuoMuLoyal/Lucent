# Assistant Contract

Last updated: 2026-06-19

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
- RAG / leaflet retrieval
- broad conversation management such as rename or delete

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
- RAG is still off
- persisted assistant conversations are live
- cross-conversation memory is optional and controlled by `assistantMemoryEnabled`
