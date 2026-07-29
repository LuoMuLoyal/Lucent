import { END, START, StateGraph } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { MAX_TOOL_LOOPS } from '../../tools/tool-constants';
import { buildToolDefinitions } from '../../tools/tool-definitions';
import type { AssistantToolName } from '../../tools/tool-types';
import type { AssistantToolExecutionResult } from '../../types/assistant.types';
import { AssistantRuntimeState } from './state';
import { selectAllowedToolsForContextSources } from './router';

export { AssistantRuntimeState, ASSISTANT_RUNTIME_NODE_NAMES } from './state';
export { selectAllowedToolsForContextSources } from './router';

/** Callback type for executing tools inside the graph. */
export type ToolExecutorFn = (
  toolNames: readonly AssistantToolName[],
) => Promise<AssistantToolExecutionResult[]>;

/** Callback type for creating the LLM model. */
export type ModelFactoryFn = () => BaseChatModel;

/** Callback type for building the system prompt. */
export type SystemPromptFn = (tools: readonly AssistantToolName[]) => string;

export interface AssistantGraphDeps {
  createModel: ModelFactoryFn;
  executeTools: ToolExecutorFn;
  buildSystemPrompt: SystemPromptFn;
}

/**
 * Builds a LangGraph with a real agent ↔ tools loop.
 *
 * Graph structure:
 * ```
 * START → prepare_context → agent ↔ tools → respond → END
 * ```
 *
 * - `prepare_context` sets up allowed tools and initial messages.
 * - `agent` calls the LLM with tools bound. If the LLM returns tool calls,
 *   routes to `tools`. Otherwise stores the text response and routes to
 *   `respond`.
 * - `tools` executes the requested tools, appends ToolMessages, and loops
 *   back to `agent`.
 * - Loop is capped at {@link MAX_TOOL_LOOPS}.
 */
export function buildAssistantRuntimeGraph(deps: AssistantGraphDeps) {
  return (
    new StateGraph(AssistantRuntimeState)
      // ── prepare_context ────────────────────────────────────────────────
      .addNode('prepare_context', (state) => {
        const allowedTools = selectAllowedToolsForContextSources(
          state.enabledContextSources,
        );
        const systemPrompt = deps.buildSystemPrompt(allowedTools);
        const messages: BaseMessage[] = [
          new SystemMessage(systemPrompt),
          new HumanMessage(state.userMessage),
        ];
        return {
          allowedTools,
          messages,
          loopCount: 0,
          pendingToolCalls: [],
          toolResults: [],
          finalContent: null,
          selectedTools: [],
          stopReason: null,
        };
      })

      // ── agent ──────────────────────────────────────────────────────────
      .addNode('agent', async (state) => {
        if (state.allowedTools.length === 0) {
          return {
            pendingToolCalls: [],
            finalContent: null,
            stopReason: 'no_match' as const,
          };
        }

        const model = deps.createModel();
        const toolDefs = buildToolDefinitions(state.allowedTools);
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
            const toolNames = toolCalls.map(
              (tc) => tc.name as AssistantToolName,
            );
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
      })

      // ── tools ──────────────────────────────────────────────────────────
      .addNode('tools', async (state) => {
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
      })

      // ── respond ────────────────────────────────────────────────────────
      .addNode('respond', () => ({}))

      // ── Edges ──────────────────────────────────────────────────────────
      .addEdge(START, 'prepare_context')
      .addEdge('prepare_context', 'agent')
      .addConditionalEdges('agent', (state) => {
        if (
          state.pendingToolCalls.length > 0 &&
          state.loopCount < MAX_TOOL_LOOPS
        ) {
          return 'tools';
        }
        if (
          state.pendingToolCalls.length > 0 &&
          state.loopCount >= MAX_TOOL_LOOPS
        ) {
          return 'respond';
        }
        return 'respond';
      })
      .addEdge('tools', 'agent')
      .addEdge('respond', END)
      .compile()
  );
}
