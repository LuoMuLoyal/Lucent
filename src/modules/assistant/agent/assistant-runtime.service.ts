import { Injectable } from '@nestjs/common';
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { LlmRuntimeService } from '../../llm-runtime/llm-runtime.service';
import type { AssistantRuntimeCapabilities } from '../types/assistant.types';
import type {
  AssistantMessageResult,
  AssistantConversationMessage,
  AssistantStreamChunkEvent,
  AssistantToolExecutionResult,
} from '../types/assistant.types';
import {
  ASSISTANT_CONTEXT_SOURCES,
  ASSISTANT_IMPLEMENTED_TOOL_NAMES,
  ASSISTANT_TOOL_NAMES,
} from '../tools/assistant-tool.types';
import type {
  AssistantContextSource,
  AssistantToolName,
} from '../tools/assistant-tool.types';
import { buildAssistantSystemPrompt } from '../prompts/assistant-system.prompt';
import {
  ASSISTANT_RUNTIME_NODE_NAMES,
  type AssistantRuntimeState,
  buildAssistantRuntimeGraph,
} from './assistant-runtime.graph';

const CHAT_MODEL_OPTIONS = {
  timeout: 10_000,
  temperature: 0.2,
  maxRetries: 0,
} as const;

@Injectable()
export class AssistantRuntimeService {
  private readonly foundationGraph = buildAssistantRuntimeGraph();

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
    enabledContextSources: AssistantContextSource[];
  }): Promise<AssistantRuntimeState> {
    return this.foundationGraph.invoke(input);
  }

  async generateStream(
    input: {
      locale: string;
      messages: AssistantConversationMessage[];
      allowedTools: readonly AssistantToolName[];
      toolResults: readonly AssistantToolExecutionResult[];
    },
    onChunk: (event: AssistantStreamChunkEvent) => void | Promise<void>,
  ): Promise<AssistantMessageResult> {
    const model = this.llmRuntimeService.createChatModel(
      'chat',
      CHAT_MODEL_OPTIONS,
    );
    const stream = await model.stream(
      this.buildMessages(input.messages, input.allowedTools, input.toolResults),
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
      throw new Error('Assistant stream ended without any assistant content.');
    }

    return {
      content: finalContent,
      usedToolNames: input.toolResults.map((result) => result.name),
    };
  }

  describeFoundation(): AssistantRuntimeCapabilities {
    return {
      phase: 'foundation',
      chatModelConfigured: this.hasChatModel(),
      interactiveChatReady: this.hasChatModel(),
      langGraphReady: true,
      ragEnabled: false,
      graphNodeNames: ASSISTANT_RUNTIME_NODE_NAMES,
      toolNames: ASSISTANT_TOOL_NAMES,
      implementedToolNames: ASSISTANT_IMPLEMENTED_TOOL_NAMES,
      contextSources: ASSISTANT_CONTEXT_SOURCES,
    };
  }

  private buildMessages(
    messages: AssistantConversationMessage[],
    allowedTools: readonly AssistantToolName[],
    _toolResults: readonly AssistantToolExecutionResult[],
  ) {
    return [
      new SystemMessage(buildAssistantSystemPrompt(allowedTools)),
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
