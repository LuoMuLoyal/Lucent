import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';
import { buildKnowledgeSubGraph } from './knowledge';

function streamFromInvoke(invoke: (...args: unknown[]) => unknown) {
  return vi.fn().mockImplementation(async (...args: unknown[]) => {
    const response = (await invoke(...args)) as AIMessage;
    return (async function* () {
      await Promise.resolve();
      yield new AIMessageChunk({
        content: response.content,
        tool_calls: response.tool_calls,
      } as never);
    })();
  });
}

const BASE_INPUT = {
  userId: 'user-1',
  userMessage: '查一下国药准字H10900089这个药的说明书',
  locale: 'zh-CN' as const,
  enabledContextSources: ['current_medicines' as const],
  allowedTools: [
    'search_medicine_leaflets' as const,
    'search_cn_medicine_products' as const,
    'get_cn_medicine_detail' as const,
  ],
  // Deliberately unordered: knowledge_route must reorder along the chain.
  relevantTools: [
    'search_medicine_leaflets' as const,
    'search_cn_medicine_products' as const,
    'get_cn_medicine_detail' as const,
  ],
  messages: [
    new SystemMessage('knowledge system prompt'),
    new HumanMessage('查一下国药准字H10900089这个药的说明书'),
  ],
};

function buildGraph({
  coverageStatus,
}: {
  coverageStatus: 'complete' | 'empty';
}) {
  const mockInvoke = vi
    .fn()
    .mockResolvedValueOnce(
      new AIMessage({
        content: '',
        tool_calls: [
          { name: 'search_cn_medicine_products', id: 'call_0', args: {} },
        ],
      }),
    )
    .mockResolvedValueOnce(new AIMessage({ content: '根据说明书，该药…' }));
  const mockModel = {
    bindTools: vi.fn().mockReturnValue({
      stream: streamFromInvoke(mockInvoke),
    }),
    stream: streamFromInvoke(
      vi.fn().mockResolvedValue(new AIMessage({ content: '兜底。' })),
    ),
  };
  const executeTools = vi.fn().mockResolvedValue([
    {
      name: 'search_cn_medicine_products',
      data: {
        coverage: { status: coverageStatus, reason: null },
        ambiguities: [],
      },
    },
  ]);
  const graph = buildKnowledgeSubGraph({
    createModel: () => mockModel as never,
    executeTools: executeTools as never,
  });
  return { graph, executeTools };
}

describe('knowledge sub-graph', () => {
  it('reorders tools along the dependency chain', async () => {
    const { graph, executeTools } = buildGraph({
      coverageStatus: 'complete',
    });

    const result = await graph.invoke(BASE_INPUT);

    expect(result.relevantTools).toEqual([
      'search_cn_medicine_products',
      'get_cn_medicine_detail',
      'search_medicine_leaflets',
    ]);
    expect(executeTools).toHaveBeenCalledTimes(1);
  });

  it('passes through with complete evidence', async () => {
    const { graph } = buildGraph({ coverageStatus: 'complete' });

    const result = await graph.invoke(BASE_INPUT);

    expect(result.finalContent).toBe('根据说明书，该药…');
    expect(result.validationFlags.hasEmptyResults).toBe(false);
    expect(result.stopReason).toBe('answered');
  });

  it('sets no_evidence when retrieval has zero hits', async () => {
    const { graph } = buildGraph({ coverageStatus: 'empty' });

    const result = await graph.invoke(BASE_INPUT);

    expect(result.validationFlags.hasEmptyResults).toBe(true);
    expect(result.stopReason).toBe('no_evidence');
    const appended = result.messages.slice(1);
    expect(
      appended.some(
        (m) =>
          m instanceof SystemMessage &&
          typeof m.content === 'string' &&
          m.content.includes('no evidence'),
      ),
    ).toBe(true);
  });
});
