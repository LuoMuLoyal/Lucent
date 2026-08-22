import type {
  AssistantContextSource,
  AssistantToolDisabledReason,
  AssistantToolName,
} from '../tools/shared/tool-types';

export interface AssistantRuntimeCapabilities {
  phase: 'foundation';
  chatModelConfigured: boolean;
  interactiveChatReady: boolean;
  langGraphReady: boolean;
  ragEnabled: boolean;
  graphNodeNames: readonly string[];
  toolNames: readonly AssistantToolName[];
  implementedToolNames: readonly AssistantToolName[];
  contextSources: readonly AssistantContextSource[];
}

export interface AssistantToolCapabilitySnapshot {
  name: AssistantToolName;
  requiredContextSources: AssistantContextSource[];
  permittedByUser: boolean;
  implemented: boolean;
  enabled: boolean;
  disabledReason: AssistantToolDisabledReason | null;
}

export interface AssistantPolicySnapshot {
  interactiveChatReady: boolean;
  enabledContextSources: AssistantContextSource[];
  contextPermittedToolNames: AssistantToolName[];
  executableToolNames: AssistantToolName[];
  toolCapabilities: AssistantToolCapabilitySnapshot[];
}

export interface AssistantConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantConversationSnapshotMessage {
  role: 'user' | 'assistant';
  content: string;
  usedTools: string[];
  createdAt: string;
}

export interface AssistantConversationSnapshot {
  id: string;
  title: string | null;
  status: 'active' | 'archived' | 'deleted';
  messages: AssistantConversationSnapshotMessage[];
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantConversationSummary {
  id: string;
  title: string | null;
  status: 'active' | 'archived' | 'deleted';
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantStreamChunkEvent {
  content: string;
}

export interface AssistantMessageResult {
  content: string;
  usedToolNames: AssistantToolName[];
}

export type AssistantReadCoverageStatus = 'complete' | 'partial' | 'empty';
export type AssistantReadConfidenceLevel = 'high' | 'medium' | 'low';

export interface AssistantReadCoverage {
  status: AssistantReadCoverageStatus;
  reason: string | null;
  omittedContextSources?: AssistantContextSource[];
  omittedKinds?: string[];
}

export interface AssistantReadTimeRange {
  timezone: 'UTC';
  startDate: string | null;
  endDate: string | null;
}

export interface AssistantReadSourceMeta {
  tool: AssistantToolName;
  generatedAt: string;
  tables: string[];
}

export interface AssistantReadConfidence {
  level: AssistantReadConfidenceLevel;
  reason: string;
}

export interface AssistantReadResultEnvelope {
  [key: string]: unknown;
  query: Record<string, unknown>;
  result: Record<string, unknown>;
  coverage: AssistantReadCoverage;
  timeRange: AssistantReadTimeRange;
  source: AssistantReadSourceMeta;
  confidence: AssistantReadConfidence;
  ambiguities: string[];
}

export interface AssistantProposalPreviewField {
  label: string;
  value: string;
}

export interface AssistantCreateDailyRecordProposalPayload {
  type: 'create_daily_record';
  draft: {
    kind:
      | 'water'
      | 'meal'
      | 'symptom'
      | 'note'
      | 'sleep'
      | 'vital'
      | 'activity';
    occurredAt: string;
    title: string | null;
    value: string | null;
    unit: string | null;
    note: string | null;
    payload: Record<string, unknown> | null;
  };
}

export interface AssistantUpdateDailyRecordProposalPayload {
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

export interface AssistantDeleteDailyRecordProposalPayload {
  type: 'delete_daily_record';
  recordId: string;
}

export interface AssistantUpdateUserSettingsProposalPayload {
  type: 'update_user_settings';
  draft: {
    assistantEnabled?: boolean;
    assistantMemoryEnabled?: boolean;
    assistantContext?: {
      healthProfile?: boolean;
      dailyRecords?: boolean;
      sleepRecords?: boolean;
      currentMedicines?: boolean;
    };
  };
}

export interface AssistantProposalTarget {
  kind: 'daily_record' | 'user_settings' | 'daily_record_draft';
  label: string;
  recordId?: string;
  settingKeys?: string[];
  matchedBy?: string[];
  snapshot?: Record<string, unknown>;
}

export interface AssistantProposedAction {
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
  previewFields: AssistantProposalPreviewField[];
  target: AssistantProposalTarget;
  constraints: string[];
  expiresAt: string;
  payloadVersion: 1;
  payload:
    | AssistantCreateDailyRecordProposalPayload
    | AssistantUpdateDailyRecordProposalPayload
    | AssistantDeleteDailyRecordProposalPayload
    | AssistantUpdateUserSettingsProposalPayload;
}

/**
 * Internal runtime envelope returned by tool execution. Unlike
 * `AssistantToolDetailDto`, this shape carries raw tool data and optional
 * proposal/timeout control state before the client-facing projection.
 */
export interface AssistantToolExecutionResult {
  name: AssistantToolName;
  data: Record<string, unknown>;
  proposedActions?: AssistantProposedAction[];
  /**
   * True when the tool hit the per-tool execution timeout (F-6); the data
   * envelope then carries `{ timeout: true, reason: ... }` so the model can
   * observe the timeout without the graph aborting.
   */
  timeout?: boolean;
}

export interface AssistantToolExecutionContext {
  userId: string;
  locale: 'zh-CN' | 'en';
  userMessage: string;
  enabledContextSources: readonly AssistantContextSource[];
  memoryEnabled: boolean;
}
