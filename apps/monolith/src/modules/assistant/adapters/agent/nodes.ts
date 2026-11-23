import { ToolMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ToolName } from '../../domain/policies/tool-permission.js';
import {
  buildToolDefinitions,
  withExternalToolDefinitions,
  type ToolLimitBudgets,
} from '../acl/tools/shared/tool-definitions.js';
import type { AssistantToolExecutionResult } from '../../application/ports/assistant.js';
import type { AssistantToolCall } from '../../application/ports/assistant.js';
import type { AssistantRuntimeState } from './state.js';
import type { AssistantGraphDeps } from './deps.js';
import {
  AMAP_MCP_SERVER_NAME,
  externalLoaderName,
  isExternalLoaderName,
} from '../../domain/mcp/external-tools.js';

/** One remote tool definition, as the runtime hands it over. */
type RemoteTool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
};

/**
 * Picks the remote tools to bind for this turn.
 *
 * Returns the server's `load_tools` plus only those tools the conversation has
 * already loaded. Everything else stays out of the context and is described by
 * the prompt catalog instead (see `renderExternalToolCatalog`).
 *
 * A loaded name that the server no longer offers is silently skipped: the
 * remote list can change between turns, and a stale name must not make the
 * whole bind fail.
 *
 * @param listExternalTools - the server's tools, or undefined when no external
 *   server is configured (then nothing is bound, not even a loader).
 * @param loaded - names this conversation has loaded so far.
 */
async function selectLoadedExternalTools(
  listExternalTools: AssistantGraphDeps['listExternalTools'],
  loaded: readonly string[],
): Promise<RemoteTool[]> {
  if (listExternalTools == null) return [];

  const offered = await listExternalTools();
  if (offered.length === 0) return [];

  // The loader itself is not in `offered` (the server never advertises it), so
  // it is added here. Its schema is fixed: an array of tool names.
  const loaderName = externalLoaderName(AMAP_MCP_SERVER_NAME);
  const loader: RemoteTool = {
    name: loaderName,
    description:
      `Add tools from MCP server ${AMAP_MCP_SERVER_NAME} to your tool list. ` +
      `The system prompt lists them under "On-demand tools from MCP server ${AMAP_MCP_SERVER_NAME}".`,
    inputSchema: {
      type: 'object',
      properties: {
        tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tool names exactly as that list shows them.',
        },
      },
      required: ['tools'],
    },
  };

  const wanted = new Set(loaded);
  return [loader, ...offered.filter((tool) => wanted.has(tool.name))];
}
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
  /**
   * Remote MCP tools to advertise alongside the built-in ones (see
   * `AssistantGraphDeps.listExternalTools`). Absent / empty means none.
   */
  listExternalTools?: AssistantGraphDeps['listExternalTools'];
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
    const builtInDefs = buildToolDefinitions(toolNames, deps.toolBudgets?.());
    // On-demand loading (mirrors DSH's `McpToolLoader`): the remote server's
    // tools are *not* bound here. Only two things are:
    //
    // 1. the server's `load_tools`, always — without it the model has no way to
    //    bring anything in, and the prompt catalog would name a tool that does
    //    not exist in the list;
    // 2. the tools this conversation has already loaded.
    //
    // Binding the full set every turn is what this replaces: it put every
    // remote JSON schema in the context on every step, whether or not the turn
    // had anything to do with maps.
    const externalDefs = await selectLoadedExternalTools(
      deps.listExternalTools,
      state.loadedExternalTools,
    );
    const toolDefs = withExternalToolDefinitions(builtInDefs, externalDefs);
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

    // On-demand loading writes back here, not in the executor: the executor is
    // stateless (it also serves the MCP server and the proposal flow), while
    // "what this conversation has loaded" is graph state.
    //
    // The names are read from the *call arguments*, not from the result
    // envelope: the loader echoes back what it accepted, but a name the server
    // did not offer is dropped there, and trusting the echo would mean the
    // graph channel and the bound set could disagree.
    const loadedNow = toolCalls
      .filter((call) => isExternalLoaderName(call.name))
      .flatMap((call) => readRequestedToolNames(call.args));

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
      ...(loadedNow.length > 0 ? { loadedExternalTools: loadedNow } : {}),
    };
  };
}

/**
 * Reads the `tools` argument of a `load_tools` call.
 *
 * Tolerant on purpose: the argument comes from the model, so it can be a
 * string instead of an array, contain non-strings, or be missing entirely.
 * Anything unusable yields `[]` — the executor has already reported the real
 * validation failure back to the model, and this must not throw inside a node.
 */
function readRequestedToolNames(args: Record<string, unknown>): string[] {
  const raw = args['tools'];
  if (!Array.isArray(raw)) return [];
  return raw.filter((name): name is string => typeof name === 'string');
}
