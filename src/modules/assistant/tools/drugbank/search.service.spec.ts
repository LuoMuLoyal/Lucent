import { AssistantToolDrugbankEntityResolveService } from './entity-resolve.service.js';
import { AssistantToolDrugbankSearchService } from './search.service.js';
import {
  decodeVectorCursor,
  encodeVectorCursor,
} from '../vector/vector-cursor.js';

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

describe('AssistantToolDrugbankSearchService', () => {
  beforeEach(() => {
    mockSimilaritySearchWithScore.mockReset();
    mockEnsureTable.mockReset();
  });

  it('round-trips vector cursor payloads', () => {
    expect(
      decodeVectorCursor(
        encodeVectorCursor({
          offset: 4,
          limit: 4,
          queryHash: 'abc',
        }),
        { warn: () => {} } as never,
      ),
    ).toEqual({
      offset: 4,
      limit: 4,
      queryHash: 'abc',
    });
  });

  it('searches passages only inside resolved DrugBank entities', async () => {
    mockSimilaritySearchWithScore.mockResolvedValue([
      [
        {
          pageContent: 'Ibuprofen is a nonsteroidal anti-inflammatory drug.',
          metadata: {
            drugbankId: 'DB01050',
            drugName: 'Ibuprofen',
            field: 'description',
          },
        },
        0.93,
      ],
    ]);

    const resolveService = new AssistantToolDrugbankEntityResolveService({
      drugbankDrug: {
        findMany: vi.fn().mockResolvedValue([
          {
            drugbankId: 'DB01050',
            name: 'Ibuprofen',
            casNumber: '15687-27-1',
            unii: 'WK2XYI10QM',
          },
        ]),
      },
    } as never);

    const service = new AssistantToolDrugbankSearchService(
      mockVectorStoreFactory as never,
      resolveService,
    );
    const result = await service.search({
      userId: 'user-1',
      locale: 'en',
      userMessage: 'Ibuprofen mechanism',
      enabledContextSources: [],
      memoryEnabled: false,
    });

    expect(result.result['passages']).toHaveLength(1);
    expect(result.source.tables).toContain('drugbank_drugs');
  });

  it('returns empty coverage when no resolved entity scope is supplied', async () => {
    const resolveService = new AssistantToolDrugbankEntityResolveService({
      drugbankDrug: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as never);

    const service = new AssistantToolDrugbankSearchService(
      mockVectorStoreFactory as never,
      resolveService,
    );
    const result = await service.search({
      userId: 'user-1',
      locale: 'en',
      userMessage: 'Unknown molecule',
      enabledContextSources: [],
      memoryEnabled: false,
    });

    expect(result.coverage.status).toBe('empty');
  });
});
