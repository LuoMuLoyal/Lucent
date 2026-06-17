import { Injectable } from '@nestjs/common';
import { LlmRuntimeService } from '../../llm-runtime/llm-runtime.service';
import type { AiChatFoundationCapabilities } from '../ai-chat.types';
import {
  AI_CHAT_CONTEXT_SOURCES,
  AI_CHAT_TOOL_NAMES,
} from '../tools/ai-chat-tool.types';
import {
  AI_CHAT_FOUNDATION_NODE_NAMES,
  buildAiChatFoundationGraph,
} from './ai-chat-agent.graph';

@Injectable()
export class AiChatAgentService {
  private readonly foundationGraph = buildAiChatFoundationGraph();

  constructor(private readonly llmRuntimeService: LlmRuntimeService) {}

  hasChatModel(): boolean {
    return this.llmRuntimeService.hasRoleConfig('chat');
  }

  getFoundationGraph() {
    return this.foundationGraph;
  }

  describeFoundation(): AiChatFoundationCapabilities {
    return {
      phase: 'foundation',
      chatModelConfigured: this.hasChatModel(),
      interactiveChatReady: false,
      langGraphReady: true,
      ragEnabled: false,
      graphNodeNames: AI_CHAT_FOUNDATION_NODE_NAMES,
      toolNames: AI_CHAT_TOOL_NAMES,
      implementedToolNames: [],
      contextSources: AI_CHAT_CONTEXT_SOURCES,
    };
  }
}
