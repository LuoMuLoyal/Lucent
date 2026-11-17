import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, SystemMessage } from '@langchain/core/messages';
import { MAX_TOOL_LOOPS } from '../acl/tools/shared/tool-constants.js';
import type { AssistantRuntimeState } from './state.js';
import { streamModelResponse } from './model-stream.js';
import { extractMessageText } from './message-text.js';
import { makeShortHash } from '../../../../common/helpers/infra/hash.utils.js';

/** Runtime shape of the respond graph node. */
export type RespondNode = (
  state: AssistantRuntimeState,
) => Promise<Partial<AssistantRuntimeState>>;

/**
 * Cache backend for simple-chat responses. Implemented by the host process
 * (typically backed by the NestJS cache-manager store).
 */
export interface AssistantRespondCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/** TTL for cached simple-chat replies (seconds). */
const RESPONSE_CACHE_TTL_SECONDS = 3600;

/**
 * Instructs the fallback reply when the tool loop budget ran out while tool
 * calls were still pending, so the model tells the user the tool rounds were
 * exhausted instead of silently answering without the tool results.
 */
const TOOL_LOOP_EXHAUSTED_PROMPT =
  'The tool loop budget was exhausted before the requested tool calls could complete. Tell the user the tool rounds were exhausted and answer with what is known, clearly stating the limitation.';

/** Bump when the simple-chat prompt or reply formatting changes. */
const SIMPLE_CHAT_PROMPT_VERSION = 'v1';

/** Extracts plain text from an LLM response (string / content parts). */
function extractContent(response: unknown): string {
  if (response instanceof AIMessage) {
    return extractMessageText(response.content);
  }
  return typeof response === 'string' ? response : '';
}

/**
 * Builds the respond node.
 *
 * - When `finalContent` is already present (agent or sub-graph produced a
 *   text reply), validates it is non-empty and returns unchanged.
 * - When `finalContent` is null (simple-chat fast path, or the tool loop ended
 *   without a text reply), makes a light tool-free LLM call over the current
 *   messages and stores the result.
 * - When the tool loop budget was exhausted with tool calls still pending
 *   (`pendingToolCalls` non-empty and `loopCount >= MAX_TOOL_LOOPS`), an
 *   explicit SystemMessage is appended to the model input so the fallback
 *   reply tells the user the tool rounds were exhausted.
 *
 * Output-side validation mirrors `generateStream`'s empty-content error so a
 * blank reply never reaches the client.
 *
 * Simple-chat replies are cached (key = locale + prompt version + message) so
 * repeated greetings do not burn LLM calls. Paths that carry user data
 * (memory injection or tool results) never touch the cache.
 */
export function buildRespondNode(deps: {
  createModel: () => BaseChatModel;
  respondCache?: AssistantRespondCache;
  onText?: (text: string) => void | Promise<void>;
  /** Loop cap for this build; the code baseline when absent. */
  maxToolLoops?: () => number;
}): RespondNode {
  return async (state) => {
    // Only a turn that touched no tool and injected no memory may be cached.
    //
    // The old design also required `intent === 'simple_chat'`, which marked the
    // turns the router had sent straight to `respond`. With one loop there is no
    // such marker, so the condition is spelled out as what it always meant:
    // nothing happened this turn, so the reply is a pure function of the
    // message. A turn with tool results or injected memory still never touches
    // the cache.
    const cacheable =
      !state.memoryInjected &&
      state.toolResults.length === 0 &&
      deps.respondCache != null &&
      typeof state.userMessage === 'string' &&
      state.userMessage.length > 0;
    const cacheKey = cacheable
      ? `assistant:simple-chat:${state.locale}:${SIMPLE_CHAT_PROMPT_VERSION}:${makeShortHash(state.userMessage)}`
      : null;

    if (state.finalContent != null) {
      if (state.finalContent.trim().length === 0) {
        // eslint-disable-next-line error-handling/no-bare-throw-error -- an empty model stream is an LLM runtime anomaly, surfaced to the stream orchestrator unchanged
        throw new Error('Assistant graph ended without any assistant content.');
      }
      // The agent node answered directly. Cache it here rather than in the node
      // that produced it: this is the single place that knows both the reply and
      // whether the turn was cacheable at all.
      if (cacheKey != null && deps.respondCache != null) {
        await deps.respondCache.set(
          cacheKey,
          state.finalContent,
          RESPONSE_CACHE_TTL_SECONDS,
        );
      }
      return {};
    }

    if (cacheKey != null && deps.respondCache != null) {
      const cached = await deps.respondCache.get(cacheKey);
      if (cached != null && cached.length > 0) {
        return {
          finalContent: cached,
          stopReason: 'answered' as const,
        };
      }
    }
    // Tool-loop fallback: when the agent loop hit its cap with tool calls
    // still pending, append an explicit instruction so the fallback reply
    // states the tool rounds were exhausted instead of answering out of
    // context. The cacheable fast path never reaches here (pending tool
    // calls imply tool results).
    const maxToolLoops = deps.maxToolLoops?.() ?? MAX_TOOL_LOOPS;
    const toolBudgetExhausted =
      state.pendingToolCalls.length > 0 && state.loopCount >= maxToolLoops;
    const messages = toolBudgetExhausted
      ? [...state.messages, new SystemMessage(TOOL_LOOP_EXHAUSTED_PROMPT)]
      : state.messages;

    const model = deps.createModel();
    const response = await streamModelResponse(model, messages, deps.onText);
    const content = extractContent(response).trim();
    if (content.length === 0) {
      // eslint-disable-next-line error-handling/no-bare-throw-error -- an empty model stream is an LLM runtime anomaly, surfaced to the stream orchestrator unchanged
      throw new Error('Assistant stream ended without any assistant content.');
    }

    if (cacheKey != null && deps.respondCache != null) {
      await deps.respondCache.set(
        cacheKey,
        content,
        RESPONSE_CACHE_TTL_SECONDS,
      );
    }

    // `validate` has already decided why this turn stopped, and it knows things
    // this node does not (empty coverage, a missing proposal target, a loop that
    // ran out). Writing `answered` unconditionally here would overwrite that
    // verdict — which is exactly what made `tool_cap_reached` and `no_evidence`
    // unreachable. `answered` is therefore only the fallback for a turn that had
    // no verdict of its own.
    return {
      finalContent: content,
      stopReason: state.stopReason ?? ('answered' as const),
    };
  };
}
