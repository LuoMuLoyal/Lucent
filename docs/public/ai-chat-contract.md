# AI Chat Contract

Last updated: 2026-06-18

## Summary

This contract defines the first real backend-visible AI chat surface that
Luminous can rely on.

The current contract is intentionally about:

- capability discovery
- permission discovery
- rollout truthfulness
- bounded streaming chat execution
- latest-conversation persistence and restore

It is not yet a free-form tool-calling or RAG-enabled chat contract.

## Boundary

- **Lucent provides:** the authoritative AI chat foundation status, user-level
  chat permissions, declared tool inventory, whether each tool is actually
  usable, latest-conversation persistence/restore/clear behavior, and one
  authenticated SSE chat reply route.
- **Luminous consumes:** feature gating, settings UI, and chat-page behavior
  based on server truth instead of client guesses.
- **Lucent does not yet provide:** free-form model-driven tool calling, RAG,
  multi-conversation management, or retrieval-backed long-memory compression in
  this contract step.

## API Surface

### 1. AI Chat Capabilities

**Endpoint:** `GET /api/v1/user/ai-chat/capabilities`

Authenticated (`Bearer` token).

**Response:** `{ code: 0, data: AiChatCapabilitiesDto }`

```typescript
interface AiChatCapabilitiesDto {
  phase: 'foundation';
  aiChatEnabled: boolean;
  aiChatContext: {
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
  tools: AiChatToolCapabilityDto[];
  updatedAt: string | null;
}

interface AiChatToolCapabilityDto {
  name:
    | 'health_context_snapshot'
    | 'recent_daily_records'
    | 'recent_sleep_summary'
    | 'current_medicines';
  requiredContextSources: Array<
    'health_profile' | 'daily_records' | 'sleep_records' | 'current_medicines'
  >;
  permittedByUser: boolean;
  implemented: boolean;
  enabled: boolean;
  disabledReason:
    | 'chat_disabled'
    | 'context_disabled'
    | 'model_not_configured'
    | 'not_implemented'
    | null;
}
```

### 2. AI Chat Stream

**Endpoint:** `POST /api/v1/user/ai-chat/messages/stream`

Authenticated (`Bearer` token). Transport is SSE.

**Request body:**

```typescript
interface StreamAiChatMessagesDto {
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}
```

Rules:

- `messages.length` is currently bounded to `1..20`
- each `content` is currently bounded to `1..8000` characters
- each `content` must remain non-empty after trimming
- the last message must be a non-empty `user` message
- `system` messages are not accepted from the client

**SSE events:**

```typescript
type AiChatStreamEvent =
  | {
      event: 'chunk';
      data: { content: string };
    }
  | {
      event: 'result';
      data: {
        conversationId: string;
        role: 'assistant';
        content: string;
        usedTools: string[];
        generatedAt: string;
      };
    }
  | {
      event: 'error';
      data: {
        message: string;
        code?: number;
        statusCode?: number;
      };
    }
  | {
      event: 'done';
      data: {};
    };
```

Current behavior:

- Lucent may execute a small server-approved tool subset before generation
- those tool results are injected server-side into the model context
- Lucent streams plain assistant text chunks first
- then emits one final assistant message payload
- and persists the completed user/assistant turn into the latest active
  conversation
- then emits `done`
- if the request cannot proceed, Lucent emits `error` and closes the stream

### 3. Latest Persisted Conversation

**Endpoint:** `GET /api/v1/user/ai-chat/latest`

Authenticated (`Bearer` token).

**Response:** `{ code: 0, data: AiChatConversationDto | null }`

```typescript
interface AiChatConversationDto {
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

Current behavior:

- Lucent returns the authenticated user's latest `active` conversation only
- `data` is `null` when the user has no active persisted conversation yet
- messages are ordered chronologically

### 4. Clear Latest Active Conversation

**Endpoint:** `POST /api/v1/user/ai-chat/latest/clear`

Authenticated (`Bearer` token).

**Response:**

```typescript
{
  code: 0;
  message: '';
  data: {
    cleared: boolean;
    archivedConversationId: string | null;
  }
}
```

Current behavior:

- this archives the latest `active` conversation instead of deleting rows
- `cleared: false` means there was no active conversation to archive

## Relationship To User Settings

AI chat permissions are persisted through `GET/PATCH /api/v1/user/settings`.

Current AI chat-related settings fields are:

```typescript
interface UserSettingsDto {
  aiChatEnabled: boolean;
  aiChatContext: {
    healthProfile: boolean;
    dailyRecords: boolean;
    sleepRecords: boolean;
    currentMedicines: boolean;
  };
}
```

Capabilities combine:

- these user settings
- current server foundation state
- model/runtime availability
- declared tool implementation state
- stream-route readiness

## Current Truth

- The orchestration foundation uses LangGraph.
- The active transport is SSE.
- Markdown output is expected and should be rendered faithfully by the client.
- RAG is not enabled yet.
- Tool inventory is declared and permission-aware, and a small server-approved
  subset is now executed before generation.
- The current stream route is still a bounded assistant reply path, not a full
  model-driven tool-calling agent runtime.
- Conversation persistence is now real, but currently bounded to latest-session
  restore/continue/clear rather than a multi-thread chat product surface.

## Explicit Non-Goals

1. No leaflet RAG yet.
2. No pgvector dependency yet.
3. No client-side authority over tool availability.
4. No AI-based medicine-risk judgment beyond the reviewed existing rule engine.
5. No multi-conversation browser, search, or rename/archive management UI contract yet.
6. No free-form model-driven tool invocation loop yet.
