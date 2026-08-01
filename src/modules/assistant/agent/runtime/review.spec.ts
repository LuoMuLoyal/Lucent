import { AIMessage } from '@langchain/core/messages';
import { Command, MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import { buildAssistantRuntimeGraph } from './graph';

const BASE_INPUT = {
  userId: 'user-1',
  userMessage: '帮我记录今天喝水 500ml',
  locale: 'zh-CN' as const,
  enabledContextSources: ['health_profile' as const],
};

/** Builds a graph whose write flow produces one proposal, with a MemorySaver checkpointer. */
function buildGraph() {
  const mockModel = {
    bindTools: vi.fn().mockReturnThis(),
    invoke: vi
      .fn()
      .mockResolvedValueOnce(
        new AIMessage({
          content: '',
          tool_calls: [
            { name: 'propose_create_daily_record', id: 'call_0', args: {} },
          ],
        }),
      )
      .mockResolvedValue(
        new AIMessage({ content: '已确认，请在记录页完成保存。' }),
      ),
  };
  const executeTools = vi.fn().mockResolvedValue([
    {
      name: 'propose_create_daily_record',
      data: { draft: {} },
      proposedActions: [
        {
          id: 'proposal-1',
          type: 'create_daily_record',
          status: 'proposed',
          confirmationRequired: true,
          title: '饮水记录',
          summary: '500ml',
          reason: '用户要求记录',
          previewFields: [],
          target: {},
          constraints: [],
          expiresAt: '2099-01-01T00:00:00.000Z',
          payloadVersion: 1,
          payload: {},
        },
      ],
    },
  ]);
  const graph = buildAssistantRuntimeGraph({
    createModel: () => mockModel as never,
    executeTools: executeTools as never,
    buildSystemPrompt: () => 'system',
    checkpointer: new MemorySaver(),
  });
  return { graph, mockModel, executeTools };
}

describe('in-graph proposal review (HITL)', () => {
  it('suspends the thread with pendingReview and resumes on approval', async () => {
    const { graph } = buildGraph();
    const config = { configurable: { thread_id: 'conv-1' } };

    // First invoke: the write flow reaches write_review and the invocation
    // returns the interrupted state carrying the `__interrupt__` marker.
    const interrupted = await graph.invoke(BASE_INPUT, config);
    expect(interrupted.__interrupt__).toBeDefined();
    expect(interrupted.pendingReview?.status).toBe('pending');
    expect(interrupted.pendingReview?.proposalIds).toEqual(['proposal-1']);
    expect(interrupted.stopReason).toBe('awaiting_review');

    const snapshot = await graph.getState(config);
    expect(snapshot.values.pendingReview?.status).toBe('pending');

    // Resume with approval: decision is written back and respond replies.
    const resumed = await graph.invoke(
      new Command({ resume: { decision: 'approved', note: 'ok' } }),
      config,
    );
    expect(resumed.pendingReview?.status).toBe('approved');
    expect(resumed.pendingReview?.note).toBe('ok');
    expect(resumed.pendingReview?.decidedAt).toBeTypeOf('string');
    expect(resumed.finalContent).toBe('已确认，请在记录页完成保存。');
  });

  it('records rejection without claiming any write', async () => {
    const { graph } = buildGraph();
    const config = { configurable: { thread_id: 'conv-2' } };

    const interrupted = await graph.invoke(BASE_INPUT, config);
    expect(interrupted.__interrupt__).toBeDefined();

    const resumed = await graph.invoke(
      new Command({ resume: { decision: 'rejected' } }),
      config,
    );
    expect(resumed.pendingReview?.status).toBe('rejected');
    expect(resumed.pendingReview?.note).toBeUndefined();
  });
});
