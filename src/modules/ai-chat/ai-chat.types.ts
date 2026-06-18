import type {
  AiChatContextSource,
  AiChatToolDisabledReason,
  AiChatToolName,
} from './tools/ai-chat-tool.types';

export interface AiChatFoundationCapabilities {
  phase: 'foundation';
  chatModelConfigured: boolean;
  interactiveChatReady: boolean;
  langGraphReady: boolean;
  ragEnabled: boolean;
  graphNodeNames: readonly string[];
  toolNames: readonly AiChatToolName[];
  implementedToolNames: readonly AiChatToolName[];
  contextSources: readonly AiChatContextSource[];
}

export interface AiChatToolCapabilitySnapshot {
  name: AiChatToolName;
  requiredContextSources: AiChatContextSource[];
  permittedByUser: boolean;
  implemented: boolean;
  enabled: boolean;
  disabledReason: AiChatToolDisabledReason | null;
}

export interface AiChatPolicySnapshot {
  interactiveChatReady: boolean;
  enabledContextSources: AiChatContextSource[];
  contextPermittedToolNames: AiChatToolName[];
  executableToolNames: AiChatToolName[];
  toolCapabilities: AiChatToolCapabilitySnapshot[];
}

export interface AiChatConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiChatConversationSnapshotMessage {
  role: 'user' | 'assistant';
  content: string;
  usedTools: string[];
  createdAt: string;
}

export interface AiChatConversationSnapshot {
  id: string;
  title: string | null;
  status: 'active' | 'archived';
  messages: AiChatConversationSnapshotMessage[];
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiChatConversationSummary {
  id: string;
  title: string | null;
  status: 'active' | 'archived';
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiChatStreamChunkEvent {
  content: string;
}

export interface AiChatAssistantMessageResult {
  content: string;
  usedToolNames: AiChatToolName[];
}

export interface AiChatProposalPreviewField {
  label: string;
  value: string;
}

export interface AiChatCreateDailyRecordProposalPayload {
  type: 'create_daily_record';
  draft: {
    kind: 'water' | 'meal' | 'symptom' | 'note' | 'sleep';
    occurredAt: string;
    title: string | null;
    value: string | null;
    unit: string | null;
    note: string | null;
    payload: Record<string, unknown> | null;
  };
}

export interface AiChatUpdateDailyRecordProposalPayload {
  type: 'update_daily_record';
  recordId: string;
  draft: {
    occurredAt?: string | null;
    title?: string | null;
    value?: string | null;
    unit?: string | null;
    note?: string | null;
    payload?: Record<string, unknown> | null;
  };
}

export interface AiChatDeleteDailyRecordProposalPayload {
  type: 'delete_daily_record';
  recordId: string;
}

export interface AiChatUpdateUserSettingsProposalPayload {
  type: 'update_user_settings';
  draft: {
    aiChatEnabled?: boolean;
    aiChatMemoryEnabled?: boolean;
    aiChatContext?: {
      healthProfile?: boolean;
      dailyRecords?: boolean;
      sleepRecords?: boolean;
      currentMedicines?: boolean;
    };
  };
}

export interface AiChatProposedAction {
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
  previewFields: AiChatProposalPreviewField[];
  payloadVersion: 1;
  payload:
    | AiChatCreateDailyRecordProposalPayload
    | AiChatUpdateDailyRecordProposalPayload
    | AiChatDeleteDailyRecordProposalPayload
    | AiChatUpdateUserSettingsProposalPayload;
}

export interface AiChatToolExecutionResult {
  name: AiChatToolName;
  data: Record<string, unknown>;
  proposedActions?: AiChatProposedAction[];
}

export interface AiChatToolExecutionContext {
  userId: string;
  locale: 'zh-CN' | 'en';
  userMessage: string;
  enabledContextSources: readonly AiChatContextSource[];
  memoryEnabled: boolean;
}
