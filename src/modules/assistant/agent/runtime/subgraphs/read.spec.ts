import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';
import { buildReadSubGraph } from './read';

const BASE_INPUT = {
  userId: 'user-1',
  userMessage: '我的过敏情况',
  locale: 'zh-CN' as const,
  enabledContextSources: ['health_profile' as const],
  allowedTools: ['get_user_profile' as const],
  relevantTools: ['get_user_profile' as const],
  messages: [
    new SystemMessage('read system prompt'),
    new HumanMessage('我的过敏情况'),
  ],
};

function buildGraph({
  toolResultData,
}: {
  toolResultData: Record<string, unknown>;
}) {
  const mockInvoke = vi
    .fn()
    .mockResolvedValueOnce(
      new AIMessage({
        content: '',
        tool_calls: [{ name: 'get_user_profile', id: 'call_0', args: {} }],
      }),
    )
    .mockResolvedValueOnce(
      new AIMessage({ content: '根据您的健康档案，共 2 项过敏。' }),
    );
  const mockModel = {
    bindTools: vi.fn().mockReturnValue({ invoke: mockInvoke }),
    invoke: vi.fn().mockResolvedValue(new AIMessage({ content: '兜底。' })),
  };
  const executeTools = vi.fn().mockResolvedValue([
    {
      name: 'get_user_profile',
      data: toolResultData,
    },
  ]);
  const graph = buildReadSubGraph({
    createModel: () => mockModel as never,
    executeTools: executeTools as never,
  });
  return { graph, mockInvoke, executeTools };
}

describe('read sub-graph', () => {
  it('passes through with complete coverage', async () => {
    const { graph, executeTools } = buildGraph({
      toolResultData: {
        query: {},
        result: { summary: { activeAllergyCount: 2 } },
        coverage: { status: 'complete', reason: null },
        ambiguities: [],
      },
    });

    const result = await graph.invoke(BASE_INPUT);

    expect(executeTools).toHaveBeenCalledTimes(1);
    expect(result.finalContent).toBe('根据您的健康档案，共 2 项过敏。');
    expect(result.validationFlags.hasPartialCoverage).toBe(false);
    expect(result.validationFlags.hasEmptyResults).toBe(false);
    expect(result.stopReason).toBe('answered');
  });

  it('appends a guidance message on partial coverage', async () => {
    const { graph } = buildGraph({
      toolResultData: {
        coverage: { status: 'partial', reason: 'Sleep sources omitted.' },
        ambiguities: ['Defaulted to last 7 days.'],
      },
    });

    const result = await graph.invoke(BASE_INPUT);

    expect(result.validationFlags.hasPartialCoverage).toBe(true);
    expect(result.validationFlags.hasAmbiguities).toBe(true);
    const appended = result.messages.slice(1);
    expect(
      appended.some(
        (m) =>
          m instanceof SystemMessage &&
          typeof m.content === 'string' &&
          m.content.includes('coverage is partial'),
      ),
    ).toBe(true);
  });

  it('sets no_data stop reason on empty coverage', async () => {
    const { graph } = buildGraph({
      toolResultData: {
        coverage: { status: 'empty', reason: 'No records found.' },
        ambiguities: [],
      },
    });

    const result = await graph.invoke(BASE_INPUT);

    expect(result.validationFlags.hasEmptyResults).toBe(true);
    expect(result.stopReason).toBe('no_data');
  });
});
