import { Injectable } from '@nestjs/common';
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { LlmRuntimeService } from '../../llm-runtime/llm-runtime.service';
import type { AiChatFoundationCapabilities } from '../ai-chat.types';
import type {
  AiChatAssistantMessageResult,
  AiChatConversationMessage,
  AiChatStreamChunkEvent,
} from '../ai-chat.types';
import {
  AI_CHAT_CONTEXT_SOURCES,
  AI_CHAT_TOOL_NAMES,
} from '../tools/ai-chat-tool.types';
import type {
  AiChatContextSource,
  AiChatToolName,
} from '../tools/ai-chat-tool.types';
import { buildAiChatSystemPrompt } from '../prompts/ai-chat-system.prompt';
import {
  AI_CHAT_FOUNDATION_NODE_NAMES,
  type AiChatFoundationState,
  buildAiChatFoundationGraph,
} from './ai-chat-agent.graph';

const CHAT_MODEL_OPTIONS = {
  timeout: 10_000,
  temperature: 0.2,
  maxRetries: 0,
} as const;

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

  async planConversation(input: {
    userId: string;
    userMessage: string;
    locale: string;
    enabledContextSources: AiChatContextSource[];
  }): Promise<AiChatFoundationState> {
    return this.foundationGraph.invoke(input);
  }

  async generateStream(
    input: {
      locale: string;
      messages: AiChatConversationMessage[];
      allowedTools: readonly AiChatToolName[];
    },
    onChunk: (event: AiChatStreamChunkEvent) => void | Promise<void>,
  ): Promise<AiChatAssistantMessageResult> {
    const model = this.llmRuntimeService.createChatModel(
      'chat',
      CHAT_MODEL_OPTIONS,
    );
    const stream = await model.stream(
      this.buildMessages(input.messages, input.allowedTools),
    );

    let content = '';

    for await (const chunk of stream) {
      if (!(chunk instanceof AIMessageChunk)) {
        continue;
      }

      const delta = this.readChunkText(chunk);
      if (delta.length === 0) {
        continue;
      }

      content += delta;
      await onChunk({ content: delta });
    }

    const finalContent = content.trim();
    if (finalContent.length === 0) {
      throw new Error('AI chat stream ended without any assistant content.');
    }

    return {
      content: finalContent,
      usedToolNames: [],
    };
  }

  describeFoundation(): AiChatFoundationCapabilities {
    return {
      phase: 'foundation',
      chatModelConfigured: this.hasChatModel(),
      interactiveChatReady: this.hasChatModel(),
      langGraphReady: true,
      ragEnabled: false,
      graphNodeNames: AI_CHAT_FOUNDATION_NODE_NAMES,
      toolNames: AI_CHAT_TOOL_NAMES,
      implementedToolNames: [],
      contextSources: AI_CHAT_CONTEXT_SOURCES,
    };
  }

  private buildMessages(
    messages: AiChatConversationMessage[],
    allowedTools: readonly AiChatToolName[],
  ) {
    return [
      new SystemMessage(buildAiChatSystemPrompt(allowedTools)),
      ...messages.map((message) =>
        message.role === 'user'
          ? new HumanMessage(message.content)
          : new AIMessage(message.content),
      ),
    ];
  }

  private readChunkText(chunk: AIMessageChunk): string {
    if (typeof chunk.content === 'string') {
      return chunk.content;
    }

    if (!Array.isArray(chunk.content)) {
      return '';
    }

    return chunk.content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if ('text' in part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .join('');
  }
}
