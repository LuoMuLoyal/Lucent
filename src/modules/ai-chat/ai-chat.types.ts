import type {
  AiChatContextSource,
  AiChatToolName,
} from './tools/ai-chat-tool.types';

export interface AiChatFoundationCapabilities {
  chatModelConfigured: boolean;
  langGraphReady: true;
  ragEnabled: false;
  graphNodeNames: readonly string[];
  toolNames: readonly AiChatToolName[];
  contextSources: readonly AiChatContextSource[];
}
