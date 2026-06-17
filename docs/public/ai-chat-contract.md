# AI Chat Contract

Last updated: 2026-06-17

## Summary

This contract defines the first real backend-visible AI chat surface that
Luminous can rely on.

The current contract is intentionally about:

- capability discovery
- permission discovery
- rollout truthfulness
- bounded streaming chat execution

It is not yet a free-form tool-calling or RAG-enabled chat contract.

## Boundary

- **Lucent provides:** the authoritative AI chat foundation status, user-level
  chat permissions, declared tool inventory, whether each tool is actually
  usable, and one authenticated SSE chat reply route.
- **Luminous consumes:** feature gating, settings UI, and chat-page behavior
  based on server truth instead of client guesses.
- **Lucent does not yet provide:** free-form model-driven tool calling, RAG,
  or multi-turn persisted memory in this contract step.

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
- the last message must be a `user` message
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
- then emits `done`
- if the request cannot proceed, Lucent emits `error` and closes the stream

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

## Explicit Non-Goals

1. No leaflet RAG yet.
2. No pgvector dependency yet.
3. No client-side authority over tool availability.
4. No AI-based medicine-risk judgment beyond the reviewed existing rule engine.
5. No persisted multi-turn memory yet.
6. No free-form model-driven tool invocation loop yet.
