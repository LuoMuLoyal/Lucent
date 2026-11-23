import { describe, expect, it, vi } from 'vitest';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { FakeToolCallingModel } from 'langchain';
import { CODE_TOOL_LIMIT_BUDGETS } from '../acl/tools/shared/tool-definitions.js';
import { runDeepAgentTurn } from './deep-agent-runner.js';
import type { AssistantToolExecutionResult } from '../../application/ports/assistant.js';

/**
 * Runner-level checks: the seam between the deepagents run output and the
 * `AssistantConversationResult` the caller reads. Behaviour of the loop
 * itself is deepagents' to own (see `deep-agent.spec.ts` for assembly).
 */
describe('runDeepAgentTurn', () => {
  const conversationId = `conv-runner-${String(Date.now())}`;

  function deps(overrides?: { responses?: string[] }) {
    return {
      createModel: () =>
        new FakeListChatModel({
          responses: overrides?.responses ?? ['今天的记录已经读完了。'],
        }),
      toolNames: ['get_today_records'] as const,
      budgets: CODE_TOOL_LIMIT_BUDGETS,
      // eslint-disable-next-line @typescript-eslint/require-await -- the runner awaits this port; the fake resolves nothing
      execute: async () => [] as AssistantToolExecutionResult[],
      systemPrompt: 'system',
      userMessage: '看看今天的记录',
      conversationId,
    };
  }

  it('maps a finished run onto the conversation result shape', async () => {
    const result = await runDeepAgentTurn(deps());

    expect(result.finalContent).toBe('今天的记录已经读完了。');
    expect(result.streamedContent).toBe(false);
    expect(result.selectedTools).toEqual([]);
    expect(result.toolResults).toEqual([]);
    expect(result.stopReason).toBe('answered');
  });

  it('reports no_match when the run produces no assistant text', async () => {
    // A model that only emits tool calls never produces a final text message;
    // the runner must report that as `no_match`, not as an empty answer.
    const result = await runDeepAgentTurn(deps({ responses: [''] }));

    expect(result.finalContent).toBeNull();
    expect(result.stopReason).toBe('no_match');
  });

  it('collects tool results through the wrapped executor', async () => {
    // Uses LangChain's own test fixture rather than a hand-rolled fake.
    //
    // The previous version subclassed `FakeListChatModel` and returned a
    // stubbed runnable from `bindTools`, with an instance field as the round
    // counter. That field was never incremented, so the loop re-issued the same
    // tool call until LangGraph's recursion limit fired — the `GraphRecursionError`
    // this test used to hang on.
    //
    // `FakeToolCallingModel` is the fixture the loop is actually designed
    // against: `toolCalls` is one entry per round, `index` advances by
    // `+1 % length` on every `_generate`, and the shared `indexRef` means the
    // advancement survives `bindTools` (which returns a new instance).
    const model = new FakeToolCallingModel({
      toolCalls: [
        [{ name: 'get_today_records', args: {}, id: 'call-1' }],
        // An empty round emits no `tool_calls`, which is how the loop
        // terminates: the model stops asking for tools.
        [],
      ],
    });

    const envelope: AssistantToolExecutionResult = {
      name: 'get_today_records',
      data: { coverage: { status: 'complete' }, items: [] },
    };
    const execute = vi.fn(() => Promise.resolve([envelope]));
    const result = await runDeepAgentTurn({
      createModel: () => model,
      toolNames: ['get_today_records'],
      budgets: CODE_TOOL_LIMIT_BUDGETS,
      execute,
      systemPrompt: 'system',
      userMessage: '看看今天的记录',
      conversationId,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.toolResults).toEqual([envelope]);
  });

  it('completes a turn that carries conversation history', async () => {
    // deepagents merges history + the current message into its own `messages`
    // state; asserting the exact sequence would pin framework internals. What
    // this module owns is that a history-carrying turn completes and maps.
    const result = await runDeepAgentTurn(
      deps({ responses: ['综合前面聊过的，这是回答。'] }),
    );

    expect(result.finalContent).toBe('综合前面聊过的，这是回答。');
    expect(result.stopReason).toBe('answered');
  });
});
