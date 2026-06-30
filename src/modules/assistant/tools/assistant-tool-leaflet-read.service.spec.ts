/* eslint-disable @typescript-eslint/no-explicit-any */

// Prevent @prisma/adapter-pg from failing at module load in test env
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn() }));

import type { AssistantToolExecutionContext } from '../types/assistant.types';
import { AssistantToolLeafletReadService } from './assistant-tool-leaflet-read.service';

// Mock PGVectorStore
const mockSimilaritySearchWithScore = jest.fn();
const mockAddDocuments = jest.fn();
const mockEnsureTable = jest.fn();

jest.mock('@langchain/community/vectorstores/pgvector', () => ({
  PGVectorStore: jest.fn().mockImplementation(() => ({
    similaritySearchWithScore: mockSimilaritySearchWithScore,
    addDocuments: mockAddDocuments,
    ensureTableInDatabase: mockEnsureTable,
  })),
}));

jest.mock('@langchain/openai', () => ({
  OpenAIEmbeddings: jest.fn(),
}));

jest.mock('pg', () => ({
  Pool: jest.fn(),
}));

describe('AssistantToolLeafletReadService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-25T12:00:00.000Z'));
    mockSimilaritySearchWithScore.mockReset();
    mockEnsureTable.mockReset();
    // Simulate embedding configured
    process.env['AI_EMBEDDING_API_KEY'] = 'test-key';
    process.env['AI_EMBEDDING_BASE_URL'] = 'https://test.api';
    process.env['AI_EMBEDDING_MODEL'] = 'test-model';
    process.env['DATABASE_URL'] = 'postgres://test:test@localhost:5432/test';
  });

  afterEach(() => {
    jest.useRealTimers();
    [
      'AI_EMBEDDING_API_KEY',
      'AI_EMBEDDING_BASE_URL',
      'AI_EMBEDDING_MODEL',
      'DATABASE_URL',
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    ].forEach((k) => delete process.env[k]);
  });

  function buildPrisma(overrides?: {
    cnMedicineProduct?: { findMany: jest.Mock };
    cnMedicineProductLeafletLink?: { findMany: jest.Mock; count: jest.Mock };
    medicineLeafletChunk?: { count: jest.Mock };
  }) {
    return {
      cnMedicineProduct: {
        findMany: overrides?.cnMedicineProduct?.findMany ?? jest.fn(),
      },
      cnMedicineProductLeafletLink: {
        findMany: jest.fn(),
        count: overrides?.cnMedicineProductLeafletLink?.count ?? jest.fn(),
      },
      medicineLeafletChunk: {
        count: overrides?.medicineLeafletChunk?.count ?? jest.fn(),
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
  ): any {
    return { pageContent: content, metadata };
  }

  it('reports indexed chunks availability', async () => {
    const prisma = buildPrisma({
      medicineLeafletChunk: { count: jest.fn().mockResolvedValue(1) },
    });
    const service = new AssistantToolLeafletReadService(prisma as never);

    await expect(service.hasIndexedChunks()).resolves.toBe(true);
  });

  it('returns an empty envelope for empty user message', async () => {
    const prisma = buildPrisma();
    const service = new AssistantToolLeafletReadService(prisma as never);

    const result = await service.getMedicineLeafletContext(buildContext('   '));

    expect(result.coverage.status).toBe('empty');
  });

  it('returns an empty envelope when no linked product matches', async () => {
    const prisma = buildPrisma({
      cnMedicineProduct: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const service = new AssistantToolLeafletReadService(prisma as never);

    const result = await service.getMedicineLeafletContext(
      buildContext('阿司匹林'),
    );

    expect(result.coverage.status).toBe('empty');
  });

  it('returns an ambiguous envelope for multiple matching products', async () => {
    const prisma = buildPrisma({
      cnMedicineProduct: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'p1',
            name: '阿司匹林肠溶片',
            brandName: null,
            approvalNumber: null,
            barcode: null,
            nationalDrugCode: null,
            searchText: null,
            manufacturer: 'A',
          },
          {
            id: 'p2',
            name: '阿司匹林泡腾片',
            brandName: null,
            approvalNumber: null,
            barcode: null,
            nationalDrugCode: null,
            searchText: null,
            manufacturer: 'B',
          },
        ]),
      },
      cnMedicineProductLeafletLink: {
        count: jest.fn().mockResolvedValue(1),
      } as never,
    });
    const service = new AssistantToolLeafletReadService(prisma as never);

    const result = await service.getMedicineLeafletContext(
      buildContext('阿司匹林'),
    );

    expect(result.coverage.status).toBe('partial');
    expect(result.result['candidates']).toEqual([
      '阿司匹林肠溶片',
      '阿司匹林泡腾片',
    ]);
  });

  it('returns vector search results for a single matched product', async () => {
    const prisma = buildPrisma({
      cnMedicineProduct: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'prod-1',
            name: '阿司匹林肠溶片',
            brandName: '拜阿司匹灵',
            approvalNumber: '国药准字H20240001',
            barcode: null,
            nationalDrugCode: null,
            searchText: null,
            manufacturer: 'Bayer',
          },
        ]),
      },
      cnMedicineProductLeafletLink: {
        count: jest.fn().mockResolvedValue(1),
      } as never,
    });

    mockSimilaritySearchWithScore.mockResolvedValue([
      [
        makeDoc('对阿司匹林过敏者禁用。', {
          leafletId: 'leaflet-1',
          sourceField: 'contraindications',
        }),
        0.92,
      ],
      [
        makeDoc('常见胃肠道不适。', {
          leafletId: 'leaflet-1',
          sourceField: 'adverse_reactions',
        }),
        0.85,
      ],
    ]);

    const service = new AssistantToolLeafletReadService(prisma as never);

    const result = await service.getMedicineLeafletContext(
      buildContext('阿司匹林伤胃吗'),
    );

    expect(result.coverage.status).toBe('complete');
    expect(result.result['chunks']).toEqual([
      {
        leafletId: 'leaflet-1',
        field: 'contraindications',
        text: '对阿司匹林过敏者禁用。',
        rank: 1,
        score: 0.92,
      },
      {
        leafletId: 'leaflet-1',
        field: 'adverse_reactions',
        text: '常见胃肠道不适。',
        rank: 2,
        score: 0.85,
      },
    ]);
    expect(result.source.tool).toBe('get_medicine_leaflet_context');
  });

  it('returns empty when vector search yields no results', async () => {
    const prisma = buildPrisma({
      cnMedicineProduct: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'prod-1',
            name: '阿司匹林肠溶片',
            brandName: null,
            approvalNumber: '国药准字H20240001',
            barcode: null,
            nationalDrugCode: null,
            searchText: null,
            manufacturer: 'Bayer',
          },
        ]),
      },
      cnMedicineProductLeafletLink: {
        count: jest.fn().mockResolvedValue(1),
      } as never,
    });

    mockSimilaritySearchWithScore.mockResolvedValue([]);

    const service = new AssistantToolLeafletReadService(prisma as never);

    const result = await service.getMedicineLeafletContext(
      buildContext('阿司匹林肠溶片'),
    );

    expect(result.coverage.status).toBe('empty');
  });
});
