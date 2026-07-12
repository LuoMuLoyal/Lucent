// Prevent @prisma/adapter-pg from failing at module load in test env
vi.mock('@prisma/adapter-pg', () => ({ PrismaPg: vi.fn() }));

import type { AssistantToolExecutionContext } from '../../types/types';
import { AssistantToolLeafletReadService } from './read.service';
import {
  buildVectorQueryHash,
  decodeVectorCursor,
  encodeVectorCursor,
} from '../vector-cursor';

// Mock PGVectorStore
const mockSimilaritySearchWithScore = vi.fn();
const mockAddDocuments = vi.fn();
const mockEnsureTable = vi.fn();

vi.mock('@langchain/community/vectorstores/pgvector', () => ({
  PGVectorStore: vi.fn().mockImplementation(function () {
    return {
      similaritySearchWithScore: mockSimilaritySearchWithScore,
      addDocuments: mockAddDocuments,
      ensureTableInDatabase: mockEnsureTable,
    };
  }),
}));

vi.mock('@langchain/openai', () => ({
  OpenAIEmbeddings: vi.fn(),
}));

vi.mock('pg', () => ({
  Pool: vi.fn(),
}));

describe('AssistantToolLeafletReadService', () => {
  let configService: {
    get: vi.Mock;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T12:00:00.000Z'));
    mockSimilaritySearchWithScore.mockReset();
    mockEnsureTable.mockReset();

    configService = {
      get: vi.fn((key: string) => {
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function buildPrisma(overrides?: {
    medicineLeafletChunk?: { count: vi.Mock };
  }) {
    return {
      medicineLeafletChunk: {
        count: overrides?.medicineLeafletChunk?.count ?? vi.fn(),
      },
    };
  }

  function buildContext(message: string): AssistantToolExecutionContext {
    return {
      userId: 'user-1',
      locale: 'zh-CN',
      userMessage: message,
      enabledContextSources: ['current_medicines'],
      memoryEnabled: false,
    };
  }

  function makeDoc(
    content: string,
    metadata: Record<string, unknown> = {},
  ): { pageContent: string; metadata: Record<string, unknown> } {
    return { pageContent: content, metadata };
  }

  it('reports indexed chunks availability', async () => {
    const prisma = buildPrisma({
      medicineLeafletChunk: { count: vi.fn().mockResolvedValue(1) },
    });
    const service = new AssistantToolLeafletReadService(
      prisma as never,
      configService as never,
    );

    await expect(service.hasIndexedChunks()).resolves.toBe(true);
  });

  it('round-trips vector cursor payloads', () => {
    expect(
      decodeVectorCursor(
        encodeVectorCursor({
          offset: 4,
          limit: 4,
          queryHash: 'abc',
        }),
      ),
    ).toEqual({
      offset: 4,
      limit: 4,
      queryHash: 'abc',
    });
  });

  it('returns an empty envelope for empty user message', async () => {
    const prisma = buildPrisma();
    const service = new AssistantToolLeafletReadService(
      prisma as never,
      configService as never,
    );

    const result = await service.searchMedicineLeaflets(buildContext('   '));

    expect(result.coverage.status).toBe('empty');
  });

  it('returns an empty envelope when no linked product matches', async () => {
    const prisma = buildPrisma();
    mockSimilaritySearchWithScore.mockResolvedValue([]);
    const service = new AssistantToolLeafletReadService(
      prisma as never,
      configService as never,
    );

    const result = await service.searchMedicineLeaflets(
      buildContext('阿司匹林'),
    );

    expect(result.coverage.status).toBe('empty');
  });

  it('returns partial coverage when vector hits span multiple product candidates', async () => {
    const prisma = buildPrisma();
    mockSimilaritySearchWithScore.mockResolvedValue([
      [
        makeDoc('阿司匹林肠溶片禁忌。', {
          chunkId: 'chunk-1',
          leafletId: 'leaflet-1',
          sourceField: 'contraindications',
          productIds: ['p1'],
          productNames: ['阿司匹林肠溶片'],
        }),
        0.93,
      ],
      [
        makeDoc('阿司匹林泡腾片不良反应。', {
          chunkId: 'chunk-2',
          leafletId: 'leaflet-2',
          sourceField: 'adverse_reactions',
          productIds: ['p2'],
          productNames: ['阿司匹林泡腾片'],
        }),
        0.89,
      ],
    ]);
    const service = new AssistantToolLeafletReadService(
      prisma as never,
      configService as never,
    );

    const result = await service.searchMedicineLeaflets(
      buildContext('阿司匹林'),
    );

    expect(result.coverage.status).toBe('partial');
    expect(result.result['candidates']).toEqual([
      '阿司匹林肠溶片',
      '阿司匹林泡腾片',
    ]);
  });

  it('returns vector search results with bounded page metadata', async () => {
    const prisma = buildPrisma();
    mockSimilaritySearchWithScore.mockResolvedValue([
      [
        makeDoc('对阿司匹林过敏者禁用。', {
          chunkId: 'chunk-1',
          leafletId: 'leaflet-1',
          sourceField: 'contraindications',
          productIds: ['prod-1'],
          productNames: ['阿司匹林肠溶片'],
        }),
        0.92,
      ],
      [
        makeDoc('常见胃肠道不适。', {
          chunkId: 'chunk-2',
          leafletId: 'leaflet-1',
          sourceField: 'adverse_reactions',
          productIds: ['prod-1'],
          productNames: ['阿司匹林肠溶片'],
        }),
        0.85,
      ],
    ]);

    const service = new AssistantToolLeafletReadService(
      prisma as never,
      configService as never,
    );

    const result = await service.searchMedicineLeaflets(
      buildContext('阿司匹林伤胃吗'),
    );

    expect(result.coverage.status).toBe('complete');
    expect(result.result['chunks']).toEqual([
      {
        chunkId: 'chunk-1',
        leafletId: 'leaflet-1',
        field: 'contraindications',
        productIds: ['prod-1'],
        productNames: ['阿司匹林肠溶片'],
        text: '对阿司匹林过敏者禁用。',
        rank: 1,
        score: 0.92,
      },
      {
        chunkId: 'chunk-2',
        leafletId: 'leaflet-1',
        field: 'adverse_reactions',
        productIds: ['prod-1'],
        productNames: ['阿司匹林肠溶片'],
        text: '常见胃肠道不适。',
        rank: 2,
        score: 0.85,
      },
    ]);
    expect(result.result['page']).toMatchObject({
      limit: 4,
      offset: 0,
      hasMore: false,
      nextCursor: null,
    });
    expect(result.source.tool).toBe('search_medicine_leaflets');
  });

  it('returns empty coverage instead of keyword fallback when no vector hit exists', async () => {
    const prisma = buildPrisma();
    mockSimilaritySearchWithScore.mockResolvedValue([]);

    const service = new AssistantToolLeafletReadService(
      prisma as never,
      configService as never,
    );

    const result = await service.searchMedicineLeaflets(
      buildContext('阿司匹林肠溶片'),
    );

    expect(result.coverage.status).toBe('empty');
    expect(result.coverage.reason).toContain('product');
  });

  it('applies cursor pagination over vector results', async () => {
    const prisma = buildPrisma();
    mockSimilaritySearchWithScore.mockResolvedValue([
      [
        makeDoc('禁忌一。', {
          chunkId: 'chunk-1',
          leafletId: 'leaflet-1',
          sourceField: 'contraindications',
          productIds: ['prod-1'],
          productNames: ['阿司匹林肠溶片'],
        }),
        0.95,
      ],
      [
        makeDoc('禁忌二。', {
          chunkId: 'chunk-2',
          leafletId: 'leaflet-1',
          sourceField: 'contraindications',
          productIds: ['prod-1'],
          productNames: ['阿司匹林肠溶片'],
        }),
        0.94,
      ],
      [
        makeDoc('禁忌三。', {
          chunkId: 'chunk-3',
          leafletId: 'leaflet-1',
          sourceField: 'contraindications',
          productIds: ['prod-1'],
          productNames: ['阿司匹林肠溶片'],
        }),
        0.93,
      ],
    ]);

    const service = new AssistantToolLeafletReadService(
      prisma as never,
      configService as never,
    );
    const queryHash = buildVectorQueryHash('阿司匹林禁忌', {});
    const result = await service.searchMedicineLeaflets(
      buildContext(
        JSON.stringify({
          query: '阿司匹林禁忌',
          limit: 1,
          cursor: encodeVectorCursor({
            offset: 1,
            limit: 1,
            queryHash,
          }),
        }),
      ),
    );

    expect(result.result['chunks']).toHaveLength(1);
    expect(result.result['chunks']).toEqual([
      expect.objectContaining({
        chunkId: 'chunk-2',
        rank: 2,
      }),
    ]);
  });

  it('includes the resolved product in the result envelope', async () => {
    const prisma = buildPrisma();
    mockSimilaritySearchWithScore.mockResolvedValue([
      [
        makeDoc('对阿司匹林过敏者禁用。', {
          chunkId: 'chunk-1',
          leafletId: 'leaflet-1',
          sourceField: 'contraindications',
          productIds: ['prod-1'],
          productNames: ['阿司匹林肠溶片'],
        }),
        0.92,
      ],
    ]);

    const service = new AssistantToolLeafletReadService(
      prisma as never,
      configService as never,
    );

    const result = await service.searchMedicineLeaflets(
      buildContext('阿司匹林肠溶片'),
    );

    expect(result.result['resolvedProduct']).toEqual({
      source: 'cn',
      productId: 'prod-1',
      name: '阿司匹林肠溶片',
    });
    expect(result.result['medicine']).toEqual({
      source: 'cn',
      name: '阿司匹林肠溶片',
    });
  });

  it('uses the productId filter as the resolved product', async () => {
    const prisma = buildPrisma();
    mockSimilaritySearchWithScore.mockResolvedValue([
      [
        makeDoc('阿司匹林肠溶片禁忌。', {
          chunkId: 'chunk-1',
          leafletId: 'leaflet-1',
          sourceField: 'contraindications',
          productIds: ['p1'],
          productNames: ['阿司匹林肠溶片'],
        }),
        0.92,
      ],
      [
        makeDoc('阿司匹林泡腾片不良反应。', {
          chunkId: 'chunk-2',
          leafletId: 'leaflet-2',
          sourceField: 'adverse_reactions',
          productIds: ['p2'],
          productNames: ['阿司匹林泡腾片'],
        }),
        0.91,
      ],
    ]);

    const service = new AssistantToolLeafletReadService(
      prisma as never,
      configService as never,
    );

    const result = await service.searchMedicineLeaflets(
      buildContext(
        JSON.stringify({
          query: '阿司匹林',
          filters: { productId: 'p2' },
        }),
      ),
    );

    expect(result.result['resolvedProduct']).toEqual({
      source: 'cn',
      productId: 'p2',
      name: '阿司匹林泡腾片',
    });
    expect(result.result['chunks']).toHaveLength(1);
    expect((result.result['chunks'] as unknown[])[0]).toEqual(
      expect.objectContaining({
        chunkId: 'chunk-2',
        productIds: ['p2'],
      }),
    );
    expect(result.coverage.status).toBe('complete');
  });

  it('applies the sourceField filter after product resolution', async () => {
    const prisma = buildPrisma();
    mockSimilaritySearchWithScore.mockResolvedValue([
      [
        makeDoc('阿司匹林肠溶片禁忌。', {
          chunkId: 'chunk-1',
          leafletId: 'leaflet-1',
          sourceField: 'contraindications',
          productIds: ['p1'],
          productNames: ['阿司匹林肠溶片'],
        }),
        0.95,
      ],
      [
        makeDoc('阿司匹林肠溶片不良反应。', {
          chunkId: 'chunk-2',
          leafletId: 'leaflet-1',
          sourceField: 'adverse_reactions',
          productIds: ['p1'],
          productNames: ['阿司匹林肠溶片'],
        }),
        0.93,
      ],
    ]);

    const service = new AssistantToolLeafletReadService(
      prisma as never,
      configService as never,
    );

    const result = await service.searchMedicineLeaflets(
      buildContext(
        JSON.stringify({
          query: '阿司匹林肠溶片',
          filters: { sourceField: 'contraindications' },
        }),
      ),
    );

    expect(result.result['chunks']).toHaveLength(1);
    expect((result.result['chunks'] as unknown[])[0]).toEqual(
      expect.objectContaining({
        chunkId: 'chunk-1',
        field: 'contraindications',
      }),
    );
  });

  it('returns empty coverage when no chunks match the resolved product', async () => {
    const prisma = buildPrisma();
    mockSimilaritySearchWithScore
      .mockResolvedValueOnce([
        [
          makeDoc('阿司匹林肠溶片禁忌。', {
            chunkId: 'chunk-1',
            leafletId: 'leaflet-1',
            sourceField: 'contraindications',
            productIds: ['p1'],
            productNames: ['阿司匹林肠溶片'],
          }),
          0.92,
        ],
      ])
      .mockResolvedValueOnce([
        [
          makeDoc('阿司匹林泡腾片不良反应。', {
            chunkId: 'chunk-2',
            leafletId: 'leaflet-2',
            sourceField: 'adverse_reactions',
            productIds: ['p2'],
            productNames: ['阿司匹林泡腾片'],
          }),
          0.91,
        ],
      ]);

    const service = new AssistantToolLeafletReadService(
      prisma as never,
      configService as never,
    );

    const result = await service.searchMedicineLeaflets(
      buildContext('阿司匹林'),
    );

    expect(result.coverage.status).toBe('empty');
    expect(result.coverage.reason).toContain('resolved product');
  });
});
