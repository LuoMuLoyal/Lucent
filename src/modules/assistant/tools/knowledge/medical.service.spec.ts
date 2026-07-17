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
});
