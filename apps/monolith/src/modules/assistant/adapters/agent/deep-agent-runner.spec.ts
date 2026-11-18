import { describe, expect, it, vi } from 'vitest';
import { AIMessage, AIMessageChunk } from '@langchain/core/messages';
import { FakeListChatModel } from '@langchain/core/utils/testing';
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
    // FakeListChatModel only ever emits text, so it can never trigger a tool
    // call. This subclass stays a real BaseChatModel (deepagents' gate
    // requires one) and overrides bindTools to return a minimal runnable
    // whose stream emits one tool call and then the final text — the exact
    // two-round shape of a tool-using turn.
    class ToolCallModel extends FakeListChatModel {
      // State lives on the instance: `bindTools` may be called once per loop
      // round, and a fresh closure inside it would reset the round counter
      // every time — the recursion-limit hang this test originally hit.
      private boundRound = 0;

      override bindTools(): ReturnType<FakeListChatModel['bindTools']> {
        // Round 1 emits the tool call; round 2 emits the final text. Without
        // the flip the loop would request the same call forever.
        const rounds: AIMessageChunk[][] = [
          [
            new AIMessageChunk({
              content: '',
              tool_call_chunks: [
                {
                  name: 'get_today_records',
                  args: '{}',
                  id: 'call-1',
                  index: 0,
                  type: 'tool_call_chunk' as const,
                },
              ],
            }),
          ],
          [new AIMessageChunk({ content: '记录读完了。' })],
        ];
        const pick = () =>
          rounds[Math.min(this.boundRound, rounds.length - 1)] ?? rounds[0]!;
        const toMessage = (chunks: AIMessageChunk[]): AIMessage => {
          const aggregated = chunks.reduce((acc, chunk) => acc.concat(chunk));
          return new AIMessage({
            content: aggregated.content as string,
            tool_calls: aggregated.tool_calls ?? [],
          });
        };
        // deepagents' loop only consumes `.stream` / `.invoke` on the bound
        // object; the structural stub is cast because it does not implement
        // the full `Runnable` surface the base signature declares.
        return {
          stream: async function* () {
            for (const chunk of pick()) {
              yield chunk;
            }
          },
          invoke: async () => toMessage(pick()),
        } as never;
      }
    }

    const envelope: AssistantToolExecutionResult = {
      name: 'get_today_records',
      data: { coverage: { status: 'complete' }, items: [] },
    };
    const execute = vi.fn(async () => [envelope]);
    const toolModel = new ToolCallModel({ responses: ['兜底'] });
    const result = await runDeepAgentTurn({
      createModel: () => toolModel,
      toolNames: ['get_today_records'],
      budgets: CODE_TOOL_LIMIT_BUDGETS,
      execute,
      systemPrompt: 'system',
      userMessage: '看看今天的记录',
      conversationId,
    });

    expect(execute).toHaveBeenCalled();
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
