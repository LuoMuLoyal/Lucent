# Assistant Contract

Last updated: 2026-06-18

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

## Runtime Truth

- orchestration foundation is LangGraph
- streaming transport is SSE
- markdown output is expected
- RAG is still off
- persisted assistant conversations are live
- cross-conversation memory is optional and controlled by `assistantMemoryEnabled`
