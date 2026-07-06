import { AssistantToolMedicalKnowledgeService } from './medical.service';

const mockSimilaritySearchWithScore = jest.fn();
const mockEnsureTable = jest.fn();

jest.mock('@langchain/community/vectorstores/pgvector', () => ({
  PGVectorStore: jest.fn().mockImplementation(() => ({
    similaritySearchWithScore: mockSimilaritySearchWithScore,
    ensureTableInDatabase: mockEnsureTable,
  })),
}));

jest.mock('@langchain/openai', () => ({
  OpenAIEmbeddings: jest.fn(),
}));

describe('AssistantToolMedicalKnowledgeService', () => {
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'DATABASE_URL')
        return 'postgres://test:test@localhost:5432/test';
      if (key === 'ai')
        return {
          embedding: {
            apiKey: 'test-key',
            baseUrl: 'https://test.api',
            model: 'test-model',
          },
        };
      return undefined;
    }),
  };

  const i18n = {
    t: jest.fn().mockReturnValue('Reference only. Consult a clinician.'),
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
      configService as never,
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
      configService as never,
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
