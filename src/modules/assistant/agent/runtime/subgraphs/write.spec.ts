import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';
import { buildWriteSubGraph } from './write';

const BASE_INPUT = {
  userId: 'user-1',
  userMessage: '帮我记一下今天喝了 300ml 水',
  locale: 'zh-CN' as const,
  enabledContextSources: ['daily_records' as const],
  allowedTools: [
    'get_today_records' as const,
    'propose_create_daily_record' as const,
  ],
  relevantTools: [
    'get_today_records' as const,
    'propose_create_daily_record' as const,
  ],
  messages: [
    new SystemMessage('write system prompt'),
    new HumanMessage('帮我记一下今天喝了 300ml 水'),
  ],
};

function buildGraph({ withProposals }: { withProposals: boolean }) {
  const mockInvoke = vi
    .fn()
    .mockResolvedValueOnce(
      new AIMessage({
        content: '',
        tool_calls: [
          { name: 'propose_create_daily_record', id: 'call_0', args: {} },
        ],
      }),
    )
    .mockResolvedValueOnce(
      new AIMessage({ content: '好的，这是一份待确认的饮水记录草稿。' }),
    );
  const mockModel = {
    bindTools: vi.fn().mockReturnValue({ invoke: mockInvoke }),
    invoke: vi.fn().mockResolvedValue(new AIMessage({ content: '兜底。' })),
  };
  const executeTools = vi.fn().mockResolvedValue([
    {
      name: 'propose_create_daily_record',
      data: { draft: {} },
      ...(withProposals
        ? {
            proposedActions: [
              {
                id: 'proposal-1',
                type: 'create_daily_record',
                status: 'proposed',
              },
            ],
          }
        : {}),
    },
  ]);
  const graph = buildWriteSubGraph({
    createModel: () => mockModel as never,
    executeTools: executeTools as never,
  });
  return { graph, executeTools };
}

describe('write sub-graph', () => {
  it('passes through when a proposal is produced', async () => {
    const { graph } = buildGraph({ withProposals: true });

    const result = await graph.invoke(BASE_INPUT);

    expect(result.finalContent).toBe('好的，这是一份待确认的饮水记录草稿。');
    expect(result.validationFlags.missingProposedActions).toBe(false);
    expect(result.stopReason).toBe('answered');
  });

  it('sets no_target when no proposal is produced', async () => {
    const { graph } = buildGraph({ withProposals: false });

    const result = await graph.invoke(BASE_INPUT);

    expect(result.validationFlags.missingProposedActions).toBe(true);
    expect(result.stopReason).toBe('no_target');
    const appended = result.messages.slice(1);
    expect(
      appended.some(
        (m) =>
          m instanceof SystemMessage &&
          typeof m.content === 'string' &&
          m.content.includes('No write proposal was produced'),
      ),
    ).toBe(true);
  });
});
