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

export interface AiChatStreamChunkEvent {
  content: string;
}

export interface AiChatAssistantMessageResult {
  content: string;
  usedToolNames: AiChatToolName[];
}

export interface AiChatToolExecutionResult {
  name: AiChatToolName;
  data: Record<string, unknown>;
}
