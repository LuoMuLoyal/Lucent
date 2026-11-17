import { END, START, StateGraph } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { isRetryableLlmError } from '../../../../common/llm/retry/llm-retry.helper.js';
import { AI_MODEL_TIMEOUT_MS } from '../../../../config/app-defaults.constants.js';
import {
  MAX_TOOL_LOOPS,
  ONTOLOGY_TOOL_EXECUTION_TIMEOUT_MS,
  RETRIEVAL_TOOL_EXECUTION_TIMEOUT_MS,
  TOOL_EXECUTION_TIMEOUT_MS,
} from '../acl/tools/shared/tool-constants.js';
import type { AssistantGraphDeps } from './deps.js';
import { AssistantRuntimeState } from './state.js';
import { buildRespondNode } from './respond.js';
import { createAgentNode, createToolsNode } from './nodes.js';
import { createWriteReviewNode, createWriteReviewSetupNode } from './review.js';
import { createValidateNode } from './validate.js';

export {
  AssistantRuntimeState,
  ASSISTANT_RUNTIME_NODE_NAMES,
} from './state.js';
export { selectPermittedTools } from '../../domain/policies/tool-permission.js';
export { buildRespondNode } from './respond.js';

/**
 * Run timeout for a single node of the assistant runtime graph.
 *
 * A node is not one model call. `agent` streams a model response and `tools`
 * may run a tool whose own budget is far larger than the model timeout —
 * `reason_over_ontology` alone allows 45s for generation plus the sidecar round
 * trip.
 *
 * Bounding nodes by the *model* timeout put the ceiling below the tools' own
 * budgets, so those budgets could never be reached: the node was cancelled at
 * 10s, LangGraph retried it, and (measured through the assistant SSE endpoint)
 * the client received the start of each attempt's answer before the turn failed
 * with `Node "agent" exceeded its run timeout`. The node bound is therefore one
 * model call plus a full tool budget, with the per-tool timeouts and the tool's
 * internal budget still doing the real limiting.
 */
export const ASSISTANT_NODE_TIMEOUT_MS =
  AI_MODEL_TIMEOUT_MS +
  Math.max(
    TOOL_EXECUTION_TIMEOUT_MS,
    ONTOLOGY_TOOL_EXECUTION_TIMEOUT_MS,
    RETRIEVAL_TOOL_EXECUTION_TIMEOUT_MS,
  ) +
  5_000;

/**
 * Builds the assistant runtime graph: one ReAct loop, no routing layer.
 *
 * ```
 * START → prepare_context → agent ⇄ tools → respond → END
 * ```
 *
 * - `prepare_context` takes the memory block and writes the prompt plus the
 *   user message. It does not choose tools.
 * - `agent` binds **every** candidate tool (`state.allowedTools`, already
 *   permission-filtered) and calls the model. The model decides what to call,
 *   how often, and whether to change direction. If it returns tool calls the
 *   graph goes to `tools`; otherwise the turn is answered.
 * - `tools` executes the requested tools, appends one `ToolMessage` per call,
 *   and loops back to `agent`. The loop is capped at {@link MAX_TOOL_LOOPS} and
 *   the cap is visible as `stopReason: 'tool_cap_reached'`.
 * - `respond` produces the final text when `agent` ended without one.
 *
 * ## Why there is no `classify_intent` / sub-graph layer
 *
 * The previous design ran a separate model call to pick a tool subset, projected
 * that subset into an `intent`, and switched into a fixed sub-graph. Three
 * consequences, all observed in production:
 *
 * 1. The router saw only the current message, so a follow-up ("那你查一下") bound
 *    no tool at all.
 * 2. The sub-graphs were hard boundaries: a read turn that discovered it needed
 *    a drug lookup could not change direction inside the same turn.
 * 3. Tool selection is what function calling already does. Spending a model call
 *    to pre-decide it, then treating the answer as a hard constraint, is paying
 *    twice for the same decision.
 */
export function buildAssistantRuntimeGraph(deps: AssistantGraphDeps) {
  const checkpointer = deps.checkpointer ?? null;
  const hasHithl = checkpointer != null;
  const maxToolLoops = deps.maxToolLoops?.() ?? MAX_TOOL_LOOPS;

  const builder = new StateGraph(AssistantRuntimeState)
    // ── prepare_context ────────────────────────────────────────────────
    .addNode('prepare_context', async (state) => {
      let memoryBlock = '';
      if (
        state.memoryEnabled &&
        state.isNewConversation &&
        deps.buildMemoryBlock != null
      ) {
        memoryBlock = await deps.buildMemoryBlock(state.userId);
      }

      // The prompt is written here, in one shot: `messages` is an append
      // reducer, so anything written earlier could only be appended to, never
      // replaced. There is no per-turn tool subset left to wait for.
      const messages: BaseMessage[] = [
        new SystemMessage(deps.buildSystemPrompt(state.allowedTools)),
      ];
      if (memoryBlock.length > 0) {
        messages.push(new HumanMessage(memoryBlock));
      }
      messages.push(new HumanMessage(state.userMessage));

      return {
        memoryBlock,
        memoryInjected: memoryBlock.length > 0,
        messages,
        loopCount: 0,
        pendingToolCalls: [],
        toolResults: [],
        finalContent: null,
        selectedTools: [],
        stopReason: null,
      };
    })

    // ── agent / tools ──────────────────────────────────────────────────
    .addNode('agent', createAgentNode(deps))
    .addNode('tools', createToolsNode(deps))
    .addNode('validate', createValidateNode({ supportsReview: hasHithl }))
    // Records that the loop stopped with work still pending, so `validate` can
    // report the cap instead of mistaking it for a normal ending.
    .addNode('capped', () => ({ loopCapped: true }))

    // ── respond ────────────────────────────────────────────────────────
    .addNode(
      'respond',
      buildRespondNode({
        createModel: deps.createModel,
        ...(deps.onText != null ? { onText: deps.onText } : {}),
        ...(deps.respondCache != null
          ? { respondCache: deps.respondCache }
          : {}),
        maxToolLoops: () => maxToolLoops,
      }),
    )

    // ── Edges ──────────────────────────────────────────────────────────
    .addEdge(START, 'prepare_context')
    .addEdge('prepare_context', 'agent')
    .addConditionalEdges('agent', (state) => {
      // The loop continues only while there is work the model actually asked
      // for. Hitting the cap is a distinct stop reason, not a silent downgrade:
      // `validate` + `respond` turn it into a reply that says the tool rounds
      // ran out.
      //
      // No pending calls always means "stop": `agent` either produced text
      // (`finalContent`) or had nothing to bind (`no_match`), and `respond` is
      // the node that turns the latter into an answer. Looping back to `agent`
      // here would spin forever.
      if (state.pendingToolCalls.length === 0) {
        return 'validate';
      }
      return 'tools';
    })
    .addConditionalEdges('tools', (state) =>
      // The cap is decided *after* execution, not before: `agent` reports the
      // calls it wants, `tools` runs them, and only then does it mean anything
      // to say "the model still wants more". Checking before the run would cut
      // off the final round the model actually asked for.
      state.loopCount >= maxToolLoops ? 'capped' : 'agent',
    )
    .addEdge('capped', 'validate')
    .addEdge('respond', END)
    // Graph-wide node defaults: every node inherits these unless it opts
    // out via addNode(..., { retryPolicy: false }). `retryOn` is an explicit
    // whitelist so non-transient errors (400/401) are never retried.
    .setNodeDefaults({
      retryPolicy: {
        retryOn: isRetryableLlmError,
        maxAttempts: 3,
      },
      timeout: deps.nodeTimeoutMs?.() ?? ASSISTANT_NODE_TIMEOUT_MS,
      cachePolicy: false,
    });

  // HITL review: when a checkpointer is available, a turn that produced
  // proposals pauses at `write_review` until the client confirms via the
  // confirm endpoint. Without a checkpointer (or without a thread) the turn
  // flows straight to `respond` — `validate` still records `pendingReview`, but
  // nothing suspends on it, so the reply says the draft is waiting without
  // pretending a thread is parked.
  if (hasHithl) {
    builder
      .addNode('write_review_setup', createWriteReviewSetupNode())
      .addNode('write_review', createWriteReviewNode())
      .addConditionalEdges('validate', (state) =>
        state.pendingReview?.status === 'pending'
          ? 'write_review_setup'
          : 'respond',
      )
      .addEdge('write_review_setup', 'write_review')
      .addEdge('write_review', 'respond');
  } else {
    builder.addEdge('validate', 'respond');
  }

  return builder.compile({
    ...(hasHithl ? { checkpointer } : {}),
  });
}
