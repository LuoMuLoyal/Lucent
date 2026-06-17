# AI Chat Contract

Last updated: 2026-06-17

## Summary

This contract defines the first backend-visible AI chat foundation that Luminous
can rely on before a real end-user chat conversation route ships.

The current contract is intentionally about:

- capability discovery
- permission discovery
- rollout truthfulness

It is not yet a real chat-message execution contract.

## Boundary

- **Lucent provides:** the authoritative AI chat foundation status, user-level chat
  permissions, declared tool inventory, and whether each tool is actually usable.
- **Luminous consumes:** feature gating, settings UI, and future chat-page behavior
  based on server truth instead of client guesses.
- **Lucent does not yet provide:** a real message-send or response-stream route in
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

## Current Truth

- The orchestration foundation uses LangGraph.
- The recommended future transport is SSE.
- Markdown output is expected and should be rendered faithfully by the client.
- RAG is not enabled yet.
- Tool inventory is declared, but actual tool execution is not yet exposed as a
  real interactive chat route in this contract step.

## Explicit Non-Goals

1. No real chat send/stream endpoint yet.
2. No leaflet RAG yet.
3. No pgvector dependency yet.
4. No client-side authority over tool availability.
5. No AI-based medicine-risk judgment beyond the reviewed existing rule engine.
