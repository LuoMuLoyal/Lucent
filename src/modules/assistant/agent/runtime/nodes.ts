import { AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AssistantToolName } from '../../tools/shared/tool-types';
import { buildToolDefinitions } from '../../tools/shared/tool-definitions';
import type { AssistantToolExecutionResult } from '../../types/assistant.types';
import type { AssistantRuntimeState } from './state';

/** Runtime node signature shared by the main graph and sub-graphs. */
export type RuntimeNode = (
  state: AssistantRuntimeState,
) => Promise<Partial<AssistantRuntimeState>>;

/**
 * Creates the agent node: binds the narrowed tools, invokes the LLM, and
 * either emits tool calls or stores the final text reply.
 *
 * Shared by the main graph and the read/write/knowledge sub-graphs.
 */
export function createAgentNode(deps: {
  createModel: () => BaseChatModel;
}): RuntimeNode {
  return async (state) => {
    if (state.relevantTools.length === 0) {
      return {
        pendingToolCalls: [],
        finalContent: null,
        stopReason: 'no_match' as const,
      };
    }

    const model = deps.createModel();
    const toolDefs = buildToolDefinitions(state.relevantTools);
    const boundModel = model.bindTools?.(toolDefs);

    if (boundModel == null || typeof boundModel.invoke !== 'function') {
      return {
        pendingToolCalls: [],
        finalContent: null,
        stopReason: 'no_match' as const,
      };
    }

    const response = await boundModel.invoke(state.messages);

    if (response instanceof AIMessage) {
      const toolCalls = response.tool_calls;
      if (toolCalls != null && toolCalls.length > 0) {
        const toolNames = toolCalls.map((tc) => tc.name as AssistantToolName);
        return {
          messages: [response],
          pendingToolCalls: toolNames,
          finalContent: null,
          selectedTools: toolNames,
        };
      }

      const content =
        typeof response.content === 'string'
          ? response.content
          : Array.isArray(response.content)
            ? response.content
                .map((part) =>
                  typeof part === 'string'
                    ? part
                    : 'text' in part && typeof part.text === 'string'
                      ? part.text
                      : '',
                )
                .join('')
            : '';

      return {
        messages: [response],
        pendingToolCalls: [],
        finalContent: content,
        selectedTools: [],
        stopReason: 'answered' as const,
      };
    }

    return {
      pendingToolCalls: [],
      finalContent: null,
      stopReason: 'no_match' as const,
    };
  };
}

/**
 * Creates the tools node: executes the pending tool calls and appends
 * ToolMessages plus accumulated results.
 *
 * Shared by the main graph and the read/write/knowledge sub-graphs.
 */
export function createToolsNode(deps: {
  executeTools: (
    toolNames: readonly AssistantToolName[],
  ) => Promise<AssistantToolExecutionResult[]>;
}): RuntimeNode {
  return async (state) => {
    const toolNames = state.pendingToolCalls;
    const results = await deps.executeTools(toolNames);

    const toolMessages = results.map(
      (result, index) =>
        new ToolMessage({
          tool_call_id: `call_${String(index)}`,
          content: JSON.stringify(result.data),
          name: result.name,
        }),
    );

    return {
      messages: toolMessages,
      toolResults: results,
      pendingToolCalls: [],
      loopCount: state.loopCount + 1,
    };
  };
}
