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
- persisted conversation restore plus recent-list switching
- explicit separation between persisted chat sessions and optional
  cross-conversation memory reuse

It is not yet a free-form tool-calling or RAG-enabled chat contract.

The next extension is now partially live as a proposal-only mutation layer.
Anything still marked `planned / not implemented yet` is not current runtime
truth.

## Boundary

- **Lucent provides:** the authoritative AI chat foundation status, user-level
  chat permissions, declared tool inventory, whether each tool is actually
  usable, latest-conversation persistence/restore/clear behavior, recent
  conversation summaries, explicit conversation activation/open behavior, and
  one authenticated SSE chat reply route.
- **Luminous consumes:** feature gating, settings UI, and chat-page behavior
  based on server truth instead of client guesses.
- **Lucent does not yet provide:** free-form model-driven tool calling, RAG,
  search/rename/delete style conversation management, or retrieval-backed
  long-memory compression in this contract step.

## Current Tool Boundary

Current implemented tool inventory:

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
- `propose_create_daily_record`
- `propose_update_daily_record`
- `propose_delete_daily_record`
- `propose_update_user_settings`

This is still a bounded pre-generation tool layer, not a free-form
multi-step tool loop.

## API Surface

### 1. AI Chat Capabilities

**Endpoint:** `GET /api/v1/user/ai-chat/capabilities`

Authenticated (`Bearer` token).

**Response:** `{ code: 0, data: AiChatCapabilitiesDto }`

```typescript
interface AiChatCapabilitiesDto {
  phase: 'foundation';
  aiChatEnabled: boolean;
  aiChatMemoryEnabled: boolean;
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
    | 'get_today_records'
    | 'get_records_by_date'
    | 'get_records_by_range'
    | 'get_today_summary_by_date'
    | 'get_report_summary_by_range'
    | 'get_recent_today_summaries'
    | 'get_recent_report_summaries'
    | 'get_user_profile'
    | 'get_user_settings'
    | 'get_current_medicines'
    | 'get_sleep_summary_by_range';
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
        proposedActions?: AiChatProposedActionDto[];
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
- the final payload may also include proposal-only write intents
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
- persisted conversations support restore/list/open UX, but they are not the
  same thing as “historical AI summaries”

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

### 5. Recent Persisted Conversations

**Endpoint:** `GET /api/v1/user/ai-chat/conversations`

Authenticated (`Bearer` token).

**Response:** `{ code: 0, data: AiChatConversationSummaryDto[] }`

```typescript
interface AiChatConversationSummaryDto {
  id: string;
  title: string | null;
  status: 'active' | 'archived';
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Current behavior:

- Lucent returns up to 20 recent persisted conversations for the authenticated
  user
- list order is newest activity first using `lastMessageAt desc`, then
  `updatedAt desc`, then `createdAt desc`
- both `active` and `archived` rows may appear because archived rows are still
  part of recent user history

### 6. Open One Persisted Conversation

**Endpoint:** `POST /api/v1/user/ai-chat/conversations/:conversationId/open`

Authenticated (`Bearer` token).

**Response:** `{ code: 0, data: AiChatConversationDto }`

Current behavior:

- Lucent verifies the target conversation belongs to the authenticated user
- if not found, the route returns `404`
- the selected conversation is promoted to `active`
- any other currently `active` conversations for that user are archived first
- the response returns the full message history in chronological order

## Relationship To User Settings

AI chat permissions are persisted through `GET/PATCH /api/v1/user/settings`.

Current AI chat-related settings fields are:

```typescript
interface UserSettingsDto {
  aiChatEnabled: boolean;
  aiChatMemoryEnabled: boolean;
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
- Conversation persistence is now real, and the first recent-session list/open
  flow exists, but this is still not a broad multi-thread chat management
  product surface.
- “Historical AI” for product use now means persisted Today/Report AI summary
  history, not assistant chat history.
- Assistant chat persistence and assistant memory are now intentionally split:
  persisted conversations exist for restore/list/open, while cross-conversation
  memory reuse is optional and controlled by `aiChatMemoryEnabled`.

## Current Read Tools + Proposal-Only Write Intent

Status:

- read tools below are implemented in the current bounded runtime
- write-intent tools below are also implemented, but they only emit proposals
  and never write directly

This slice expands assistant usefulness without introducing autonomous writes.

Rules:

- read tools stay explicit and server-owned
- write tools emit proposals only
- proposals require explicit frontend confirmation
- confirmed writes should initially route through existing product/API write
  paths instead of creating a parallel AI-only mutation channel

### Current Read Tool Inventory

#### 1. `get_today_records`

Purpose:

- fetch the authenticated user's records for the current local date

Input:

```typescript
interface GetTodayRecordsToolInput {}
```

Output:

```typescript
interface GetTodayRecordsToolResult {
  timezone: string;
  date: string; // YYYY-MM-DD
  records: DailyRecordToolItem[];
  total: number;
}
```

#### 2. `get_records_by_date`

Purpose:

- fetch one specific local date

Input:

```typescript
interface GetRecordsByDateToolInput {
  date: string; // YYYY-MM-DD
}
```

Output:

```typescript
interface GetRecordsByDateToolResult {
  timezone: string;
  date: string; // YYYY-MM-DD
  records: DailyRecordToolItem[];
  total: number;
}
```

#### 3. `get_records_by_range`

Purpose:

- fetch one inclusive local-date range

Input:

```typescript
interface GetRecordsByRangeToolInput {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  limit?: number; // server-bounded
}
```

Output:

```typescript
interface GetRecordsByRangeToolResult {
  timezone: string;
  startDate: string;
  endDate: string;
  truncated: boolean;
  days: Array<{
    date: string;
    records: DailyRecordToolItem[];
    total: number;
  }>;
}
```

#### 4. `get_today_summary_by_date`

Purpose:

- fetch one persisted Today AI summary for one concrete date

Input:

```typescript
interface GetTodaySummaryByDateToolInput {
  date: string; // YYYY-MM-DD
}
```

Output:

```typescript
interface GetTodaySummaryByDateToolResult {
  date: string;
  found: boolean;
  summary: {
    date: string | null;
    generatedAt: string;
    summary: string;
    bullets: Array<{
      kind: string;
      text: string;
    }>;
    actionLabel: string;
    confidenceNote: string;
  } | null;
}
```

#### 5. `get_report_summary_by_range`

Purpose:

- fetch one persisted Report AI summary for one concrete server-bounded range

Input:

```typescript
interface GetReportSummaryByRangeToolInput {
  range?: 'last_7_days' | 'last_30_days';
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
}
```

Output:

```typescript
interface GetReportSummaryByRangeToolResult {
  rangeKey: string | null;
  startDate: string | null;
  endDate: string | null;
  found: boolean;
  summary: {
    rangeKey: string | null;
    startDate: string | null;
    endDate: string | null;
    generatedAt: string;
    summary: string;
    bullets: Array<{
      kind: string;
      text: string;
    }>;
    actionLabel: string;
    confidenceNote: string;
  } | null;
}
```

#### 6. `get_recent_today_summaries`

Purpose:

- fetch recent persisted Today AI summaries

Input:

```typescript
interface GetRecentTodaySummariesToolInput {
  limit?: number; // server-bounded
}
```

Output:

```typescript
interface GetRecentTodaySummariesToolResult {
  summaries: Array<{
    date: string | null;
    generatedAt: string;
    summary: string;
    bullets: Array<{
      kind: string;
      text: string;
    }>;
    actionLabel: string;
    confidenceNote: string;
  }>;
  total: number;
}
```

#### 7. `get_recent_report_summaries`

Purpose:

- fetch recent persisted Report AI summaries

Input:

```typescript
interface GetRecentReportSummariesToolInput {
  limit?: number; // server-bounded
}
```

Output:

```typescript
interface GetRecentReportSummariesToolResult {
  summaries: Array<{
    rangeKey: string | null;
    startDate: string | null;
    endDate: string | null;
    generatedAt: string;
    summary: string;
    bullets: Array<{
      kind: string;
      text: string;
    }>;
    actionLabel: string;
    confidenceNote: string;
  }>;
  total: number;
}
```

#### 8. `get_user_profile`

Purpose:

- fetch a bounded profile snapshot that is safe and useful for assistant
  reasoning

Input:

```typescript
interface GetUserProfileToolInput {}
```

Output:

```typescript
interface GetUserProfileToolResult {
  profile: {
    nickname: string | null;
    sexAtBirth: string | null;
    birthDate: string | null;
    age: number | null;
    heightCm: number | null;
    bloodType: string | null;
    allergies: string[];
  };
}
```

#### 9. `get_user_settings`

Purpose:

- fetch the user settings that matter to assistant behavior and suggested
  actions

Input:

```typescript
interface GetUserSettingsToolInput {}
```

Output:

```typescript
interface GetUserSettingsToolResult {
  settings: {
    aiSummariesEnabled: boolean;
    dataSharingConsent: boolean;
    aiChatEnabled: boolean;
    aiChatMemoryEnabled: boolean;
    aiChatContext: {
      healthProfile: boolean;
      dailyRecords: boolean;
      sleepRecords: boolean;
      currentMedicines: boolean;
    };
  };
}
```

#### 10. `get_current_medicines`

Purpose:

- fetch current medicines in a structure easier for assistant reasoning than
  display-oriented UI DTOs

Input:

```typescript
interface GetCurrentMedicinesToolInput {}
```

Output:

```typescript
interface GetCurrentMedicinesToolResult {
  medicines: Array<{
    medicineId: string;
    medicineName: string;
    dose: string | null;
    frequency: string | null;
    route: string | null;
    startedAt: string | null;
    note: string | null;
  }>;
  total: number;
}
```

#### 11. `get_sleep_summary_by_range`

Purpose:

- summarize sleep data over one local-date range

Input:

```typescript
interface GetSleepSummaryByRangeToolInput {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}
```

Output:

```typescript
interface GetSleepSummaryByRangeToolResult {
  startDate: string;
  endDate: string;
  nightsWithData: number;
  averageDurationMinutes: number | null;
  averageQuality: number | null;
  entries: Array<{
    date: string;
    durationMinutes: number | null;
    quality: number | null;
    startAt: string | null;
    endAt: string | null;
  }>;
}
```

#### Reserved But Not In This Phase

- mood-focused read tools

### Shared Daily Record Read Shape

```typescript
interface DailyRecordToolItem {
  id: string;
  kind: 'water' | 'meal' | 'symptom' | 'note' | 'sleep' | 'medication';
  occurredAt: string;
  title: string | null;
  value: number | null;
  unit: string | null;
  note: string | null;
  tags: string[];
  payload: Record<string, unknown> | null;
}
```

Notes:

- `note` remains the backend storage fallback for custom/free-form entries
- client product copy may present `note` as “custom”
- `payload` keeps structured kind-specific detail such as sleep fields

### Current Write-Intent Tools

Status: implemented as proposal emitters only.

Write-intent tools do not write data. They only return structured proposals.

#### 1. `propose_create_daily_record`

```typescript
interface ProposeCreateDailyRecordToolInput {
  kind: 'water' | 'meal' | 'symptom' | 'note' | 'sleep';
  title?: string | null;
  value?: number | null;
  unit?: string | null;
  note?: string | null;
  occurredAt?: string | null;
  payload?: Record<string, unknown> | null;
}
```

#### 2. `propose_update_daily_record`

```typescript
interface ProposeUpdateDailyRecordToolInput {
  recordId: string;
  updates: {
    title?: string | null;
    value?: number | null;
    unit?: string | null;
    note?: string | null;
    occurredAt?: string | null;
    payload?: Record<string, unknown> | null;
  };
}
```

#### 3. `propose_delete_daily_record`

```typescript
interface ProposeDeleteDailyRecordToolInput {
  recordId: string;
}
```

#### 4. `propose_update_user_settings`

```typescript
interface ProposeUpdateUserSettingsToolInput {
  updates: {
    aiChatEnabled?: boolean;
    aiChatContext?: {
      healthProfile?: boolean;
      dailyRecords?: boolean;
      sleepRecords?: boolean;
      currentMedicines?: boolean;
    };
    unitSystem?: string | null;
  };
}
```

### Current Final SSE Result Extension

Status: implemented.

The final `result` event may later include assistant proposals:

```typescript
type AiChatStreamResultEvent = {
  event: 'result';
  data: {
    conversationId: string;
    role: 'assistant';
    content: string;
    usedTools: string[];
    generatedAt: string;
    proposedActions?: AiChatProposedActionDto[];
  };
};
```

### Proposed Action Shape

```typescript
interface AiChatProposedActionDto {
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
  previewFields: Array<{
    label: string;
    value: string;
  }>;
  payloadVersion: 1;
  payload:
    | CreateDailyRecordProposalPayload
    | UpdateDailyRecordProposalPayload
    | DeleteDailyRecordProposalPayload
    | UpdateUserSettingsProposalPayload;
}

interface CreateDailyRecordProposalPayload {
  type: 'create_daily_record';
  kind: 'water' | 'meal' | 'symptom' | 'note' | 'sleep';
  draft: {
    title: string | null;
    value: number | null;
    unit: string | null;
    note: string | null;
    occurredAt: string | null;
    payload: Record<string, unknown> | null;
  };
}

interface UpdateDailyRecordProposalPayload {
  type: 'update_daily_record';
  recordId: string;
  draft: {
    title?: string | null;
    value?: number | null;
    unit?: string | null;
    note?: string | null;
    occurredAt?: string | null;
    payload?: Record<string, unknown> | null;
  };
}

interface DeleteDailyRecordProposalPayload {
  type: 'delete_daily_record';
  recordId: string;
}

interface UpdateUserSettingsProposalPayload {
  type: 'update_user_settings';
  draft: {
    aiChatEnabled?: boolean;
    aiChatContext?: {
      healthProfile?: boolean;
      dailyRecords?: boolean;
      sleepRecords?: boolean;
      currentMedicines?: boolean;
    };
    unitSystem?: string | null;
  };
}
```

### Frontend Confirmation Card Protocol

Status: required by the contract; frontend execution may still roll out in
steps, but proposals are already part of the backend result payload.

The frontend should treat every `AiChatProposedActionDto` as:

1. visible
2. non-blocking for reading the assistant reply
3. non-executing until a user taps confirm

Required client behavior:

- render one card per proposed action
- show `title`, `summary`, optional `reason`, and `previewFields`
- do not auto-execute on receipt
- primary action:
  - create -> `确认保存`
  - update -> `确认修改`
  - delete -> `确认删除`
  - settings -> `确认更新`
- secondary action:
  - `编辑后确认` when the payload maps to an editable existing UI flow
- tertiary action:
  - `取消`

Execution rule:

- confirm or edit-confirm routes back into existing product write APIs/flows
- AI chat itself is not the authority to persist mutations directly in this
  phase

Initial frontend mapping guidance:

- `create_daily_record` -> Record create/quick-confirm flow
- `update_daily_record` -> existing record update flow using `recordId` + draft
- `delete_daily_record` -> existing record delete confirmation flow using
  `recordId`
- `update_user_settings` -> Settings confirmation/update flow

### First-Slice Proposal Rules

Current backend behavior is intentionally conservative:

- `propose_create_daily_record`
  - uses the existing candidate-record generation path
  - if no candidate can be derived, no proposal is emitted
- `propose_update_daily_record`
  - emits a proposal only when Lucent can match one concrete target record and
    derive a non-empty update draft
- `propose_delete_daily_record`
  - emits a proposal only when Lucent can match one concrete target record
- update/delete target matching now prefers explicit kind plus value/title/note
  hints before falling back to the newest candidate on the selected day
- `propose_update_user_settings`
  - emits a proposal only when Lucent can derive at least one explicit setting
    change

Implication:

- the assistant may still answer normally without any proposal when the write
  target is ambiguous
- “implemented” in capabilities means the server supports the proposal tool and
  may emit a proposal when the message is specific enough; it does not mean the
  server will always produce a mutation draft

## Explicit Non-Goals

1. No leaflet RAG yet.
2. No pgvector dependency yet.
3. No client-side authority over tool availability.
4. No AI-based medicine-risk judgment beyond the reviewed existing rule engine.
5. No search, rename, delete, or bulk archive conversation management contract yet.
6. No free-form model-driven tool invocation loop yet.
