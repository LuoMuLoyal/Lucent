import { ToolMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ToolName } from '../../domain/policies/tool-permission.js';
import {
  buildToolDefinitions,
  type ToolLimitBudgets,
} from '../acl/tools/shared/tool-definitions.js';
import type { AssistantToolExecutionResult } from '../../application/ports/assistant.js';
import type { AssistantToolCall } from '../../application/ports/assistant.js';
import type { AssistantRuntimeState } from './state.js';
import { streamModelResponse } from './model-stream.js';
import { extractMessageText } from './message-text.js';

/** Runtime node signature shared by the main graph and sub-graphs. */
export type RuntimeNode = (
  state: AssistantRuntimeState,
) => Promise<Partial<AssistantRuntimeState>>;

/**
 * Creates the agent node: binds every candidate tool, invokes the LLM, and
 * either emits tool calls or stores the final text reply.
 *
 * There is no narrowing step. `state.allowedTools` is what the caller already
 * permission-filtered (user context switches ∩ implemented ∩ sidecar reachable);
 * which of those the model actually calls, and how many times, is the model's
 * decision. `selectedTools` accumulates across iterations so the caller can see
 * what the turn actually used.
 */
export function createAgentNode(deps: {
  createModel: () => BaseChatModel;
  onText?: (text: string) => void | Promise<void>;
  /** Advertised tool maxima for this turn; code baselines when absent. */
  toolBudgets?: () => ToolLimitBudgets;
}): RuntimeNode {
  return async (state) => {
    const toolNames = state.allowedTools;
    if (toolNames.length === 0) {
      return {
        pendingToolCalls: [],
        finalContent: null,
        stopReason: 'no_match' as const,
      };
    }

    const model = deps.createModel();
    const toolDefs = buildToolDefinitions(toolNames, deps.toolBudgets?.());
    const boundModel = model.bindTools?.(toolDefs);

    if (boundModel == null || typeof boundModel.stream !== 'function') {
      return {
        pendingToolCalls: [],
        finalContent: null,
        stopReason: 'no_match' as const,
      };
    }

    const response = await streamModelResponse(
      boundModel,
      state.messages,
      deps.onText,
    );

    // streamModelResponse always returns an AIMessage (it throws if no
    // chunks are received), so no instanceof guard is needed here.
    const toolCalls = response.tool_calls;
    if (toolCalls != null && toolCalls.length > 0) {
      const calls: AssistantToolCall[] = toolCalls.map((toolCall) => ({
        // 原样保留 provider 的 id —— 它下面要落进 ToolMessage.tool_call_id（见
        // `createToolsNode`），丢掉它会造出与 assistant.tool_calls 不匹配的配对。
        ...(typeof toolCall.id === 'string' && toolCall.id.length > 0
          ? { id: toolCall.id }
          : {}),
        name: toolCall.name as ToolName,
        args: toolCall.args,
      }));
      return {
        messages: [response],
        pendingToolCalls: calls,
        finalContent: null,
        selectedTools: [
          ...state.selectedTools,
          ...calls.map((call) => call.name),
        ],
      };
    }

    const content = extractMessageText(response.content);

    // An empty reply is not an answer. Storing `''` would let `respond` treat the
    // turn as finished and throw on the empty content, when what actually
    // happened is that the model stopped without saying anything — `respond` can
    // still produce a reply from the results, and `validate` can still explain
    // why (empty coverage, capped loop).
    if (content.trim().length === 0) {
      return {
        messages: [response],
        pendingToolCalls: [],
        finalContent: null,
        stopReason: null,
      };
    }

    return {
      messages: [response],
      pendingToolCalls: [],
      finalContent: content,
      stopReason: 'answered' as const,
    };
  };
}

/**
 * Creates the tools node: executes the pending tool calls and appends
 * ToolMessages plus accumulated results.
 */
export function createToolsNode(deps: {
  executeTools: (
    toolCalls: readonly AssistantToolCall[],
  ) => Promise<AssistantToolExecutionResult[]>;
}): RuntimeNode {
  return async (state) => {
    const toolCalls = state.pendingToolCalls;
    const results = await deps.executeTools(toolCalls);

    // 按**调用**而不是按结果遍历：每个 tool_call 都必须有一条 ToolMessage，
    // 且 id 要对上。旧实现按结果位置自造 `call_${index}`，一旦执行层过滤掉某个调用
    // （未获许可）就会同时造成"id 对不上"和"少一条 ToolMessage"两类 400。
    const toolMessages = toolCalls.map((call, index) => {
      const result = results[index];
      return new ToolMessage({
        tool_call_id: call.id ?? `call_${String(index)}`,
        content: JSON.stringify(
          result?.data ?? { reason: 'Tool result was not produced.' },
        ),
        name: result?.name ?? call.name,
      });
    });

    return {
      messages: toolMessages,
      toolResults: results,
      pendingToolCalls: [],
      loopCount: state.loopCount + 1,
    };
  };
}
