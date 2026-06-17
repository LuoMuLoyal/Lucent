import type {
  AiChatContextSource,
  AiChatToolName,
} from './tools/ai-chat-tool.types';

export interface AiChatFoundationCapabilities {
  phase: 'foundation';
  chatModelConfigured: boolean;
  interactiveChatReady: false;
  langGraphReady: true;
  ragEnabled: false;
  graphNodeNames: readonly string[];
  toolNames: readonly AiChatToolName[];
  implementedToolNames: readonly AiChatToolName[];
  contextSources: readonly AiChatContextSource[];
}
