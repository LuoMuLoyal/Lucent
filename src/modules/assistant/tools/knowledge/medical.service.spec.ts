import { AssistantToolMedicalKnowledgeService } from './medical.service';

const mockSimilaritySearchWithScore = vi.fn();
const mockEnsureTable = vi.fn();

const mockVectorStore = {
  similaritySearchWithScore: mockSimilaritySearchWithScore,
  ensureTableInDatabase: mockEnsureTable,
};

vi.mock('@langchain/community/vectorstores/pgvector', () => ({
  PGVectorStore: vi.fn().mockImplementation(function () {
    return mockVectorStore;
  }),
}));

vi.mock('@langchain/openai', () => ({
  OpenAIEmbeddings: vi.fn(),
}));

/**
 * Mock VectorStoreFactory that returns the shared mockVectorStore.
 */
const mockVectorStoreFactory = {
  getStore: vi.fn().mockResolvedValue(mockVectorStore),
};

describe('AssistantToolMedicalKnowledgeService', () => {
  const i18n = {
    t: vi.fn().mockReturnValue('Reference only. Consult a clinician.'),
  };

  beforeEach(() => {
    mockSimilaritySearchWithScore.mockReset();
    mockEnsureTable.mockReset();
  });

  it('returns disclaimer and excludes blocked records', async () => {
    mockSimilaritySearchWithScore.mockResolvedValue([
      [
        {
          pageContent: '一般情况下应尽快线下就医。',
          metadata: {
            qaId: 'qa-1',
            question: '高烧怎么办',
            safetyLabel: 'caution',
            topic: 'triage',
          },
        },
        0.88,
      ],
    ]);

    const service = new AssistantToolMedicalKnowledgeService(
      mockVectorStoreFactory as never,
      i18n as never,
    );
    const result = await service.searchMedicalQaCorpus({
      userId: 'user-1',
      locale: 'zh-CN',
      userMessage: '高烧怎么办',
      enabledContextSources: [],
      memoryEnabled: false,
    });

    expect(result.result['disclaimer']).toBeTruthy();
    expect(result.result['knowledge']).toEqual([
      {
        qaId: 'qa-1',
        question: '高烧怎么办',
        answer: '一般情况下应尽快线下就医。',
        safetyLabel: 'caution',
        topic: 'triage',
        verifiability: 'open_corpus',
        sourceNote: '开放语料,低可信教育参考,无独立可验证来源',
        rank: 1,
        score: 0.88,
      },
    ]);
  });

  it('returns empty coverage instead of fabricating answer when no semantic hit exists', async () => {
    mockSimilaritySearchWithScore.mockResolvedValue([]);

    const service = new AssistantToolMedicalKnowledgeService(
      mockVectorStoreFactory as never,
      i18n as never,
    );
    const result = await service.searchMedicalQaCorpus({
      userId: 'user-1',
      locale: 'zh-CN',
      userMessage: '完全不存在的问题',
      enabledContextSources: [],
      memoryEnabled: false,
    });

    expect(result.coverage.status).toBe('empty');
    expect(result.result['knowledge']).toEqual([]);
  });

  it('clamps the medical QA retrieval limit to 5 and flags hasMore', async () => {
    mockSimilaritySearchWithScore.mockResolvedValue(
      Array.from({ length: 7 }, (_, index) => [
        {
          pageContent: `答案 ${String(index + 1)}`,
          metadata: {
            qaId: `qa-${String(index + 1)}`,
            question: `问题 ${String(index + 1)}`,
            safetyLabel: 'safe',
          },
        },
        0.9 - index * 0.01,
      ]),
    );

    const service = new AssistantToolMedicalKnowledgeService(
      mockVectorStoreFactory as never,
      i18n as never,
    );
    const result = await service.searchMedicalQaCorpus({
      userId: 'user-1',
      locale: 'zh-CN',
      userMessage: JSON.stringify({ query: '感冒怎么办', limit: 8 }),
      enabledContextSources: [],
      memoryEnabled: false,
    });

    const knowledge = result.result['knowledge'] as unknown[];
    expect(knowledge).toHaveLength(5);
    expect(result.result['page']).toEqual(
      expect.objectContaining({ limit: 5, offset: 0, hasMore: true }),
    );
    expect(knowledge[0]).toEqual(
      expect.objectContaining({
        qaId: 'qa-1',
        verifiability: 'open_corpus',
        sourceNote: '开放语料,低可信教育参考,无独立可验证来源',
      }),
    );
  });

  it('keeps limit 5 and 3 requests unchanged', async () => {
    for (const requested of [5, 3]) {
      mockSimilaritySearchWithScore.mockResolvedValue(
        Array.from({ length: requested }, (_, index) => [
          {
            pageContent: `答案 ${String(index + 1)}`,
            metadata: {
              qaId: `qa-${String(index + 1)}`,
              question: `问题 ${String(index + 1)}`,
              safetyLabel: 'safe',
            },
          },
          0.9 - index * 0.01,
        ]),
      );

      const service = new AssistantToolMedicalKnowledgeService(
        mockVectorStoreFactory as never,
        i18n as never,
      );
      const result = await service.searchMedicalQaCorpus({
        userId: 'user-1',
        locale: 'zh-CN',
        userMessage: JSON.stringify({ query: '感冒怎么办', limit: requested }),
        enabledContextSources: [],
        memoryEnabled: false,
      });

      const knowledge = result.result['knowledge'] as unknown[];
      expect(knowledge).toHaveLength(requested);
      expect(result.result['page']).toEqual(
        expect.objectContaining({
          limit: requested,
          offset: 0,
          hasMore: false,
        }),
      );
    }
  });
});
