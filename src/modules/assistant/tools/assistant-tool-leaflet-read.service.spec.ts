import type { AssistantToolExecutionContext } from '../types/assistant.types';
import { AssistantToolLeafletReadService } from './assistant-tool-leaflet-read.service';

describe('AssistantToolLeafletReadService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-25T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function buildPrisma(overrides?: {
    cnMedicineProduct?: { findMany: jest.Mock };
    cnMedicineProductLeafletLink?: { findMany: jest.Mock; count: jest.Mock };
    medicineLeafletChunk?: {
      findMany: jest.Mock;
      count: jest.Mock;
    };
    $queryRaw?: jest.Mock;
  }) {
    return {
      cnMedicineProduct: {
        findMany: overrides?.cnMedicineProduct?.findMany ?? jest.fn(),
      },
      cnMedicineProductLeafletLink: {
        findMany:
          overrides?.cnMedicineProductLeafletLink?.findMany ?? jest.fn(),
        count: overrides?.cnMedicineProductLeafletLink?.count ?? jest.fn(),
      },
      medicineLeafletChunk: {
        findMany: overrides?.medicineLeafletChunk?.findMany ?? jest.fn(),
        count: overrides?.medicineLeafletChunk?.count ?? jest.fn(),
      },
      $queryRaw: overrides?.$queryRaw ?? jest.fn(),
    };
  }

  function buildLlmRuntime(overrides?: { createEmbeddingModel?: jest.Mock }) {
    return {
      createEmbeddingModel:
        overrides?.createEmbeddingModel ?? jest.fn().mockReturnValue(null),
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

  it('reports indexed chunks availability', async () => {
    const prisma = buildPrisma({
      medicineLeafletChunk: {
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
    });
    const llmRuntime = buildLlmRuntime();
    const service = new AssistantToolLeafletReadService(
      prisma as never,
      llmRuntime as never,
    );

    await expect(service.hasIndexedChunks()).resolves.toBe(true);
    expect(prisma.medicineLeafletChunk.count).toHaveBeenCalledWith({ take: 1 });
  });

  it('returns an empty envelope for empty user message', async () => {
    const prisma = buildPrisma();
    const llmRuntime = buildLlmRuntime();
    const service = new AssistantToolLeafletReadService(
      prisma as never,
      llmRuntime as never,
    );

    const result = await service.getMedicineLeafletContext(buildContext('   '));

    expect(result.coverage.status).toBe('empty');
    expect(result.result).toEqual({
      medicine: null,
      leaflets: [],
      chunks: [],
    });
    expect(prisma.cnMedicineProduct.findMany).not.toHaveBeenCalled();
  });

  it('returns an empty envelope when no linked product matches', async () => {
    const prisma = buildPrisma({
      cnMedicineProduct: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const llmRuntime = buildLlmRuntime();
    const service = new AssistantToolLeafletReadService(
      prisma as never,
      llmRuntime as never,
    );

    const result = await service.getMedicineLeafletContext(
      buildContext('阿司匹林'),
    );

    expect(result.coverage.status).toBe('empty');
    expect(result.coverage.reason).toContain(
      'No Chinese medicine product matched',
    );
  });

  it('returns an empty envelope when matched product has no leaflet links', async () => {
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
            manufacturer: 'Test Pharma',
          },
        ]),
      },
      cnMedicineProductLeafletLink: {
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
    });
    const llmRuntime = buildLlmRuntime();
    const service = new AssistantToolLeafletReadService(
      prisma as never,
      llmRuntime as never,
    );

    const result = await service.getMedicineLeafletContext(
      buildContext('阿司匹林肠溶片'),
    );

    expect(result.coverage.status).toBe('empty');
    expect(result.coverage.reason).toContain(
      'No Chinese medicine product matched',
    );
  });

  it('returns an ambiguous envelope for multiple matching products', async () => {
    const prisma = buildPrisma({
      cnMedicineProduct: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'prod-1',
            name: '阿司匹林肠溶片',
            brandName: null,
            approvalNumber: null,
            barcode: null,
            nationalDrugCode: null,
            searchText: null,
            manufacturer: 'A Pharma',
          },
          {
            id: 'prod-2',
            name: '阿司匹林泡腾片',
            brandName: null,
            approvalNumber: null,
            barcode: null,
            nationalDrugCode: null,
            searchText: null,
            manufacturer: 'B Pharma',
          },
        ]),
      },
      cnMedicineProductLeafletLink: {
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
    });
    const llmRuntime = buildLlmRuntime();
    const service = new AssistantToolLeafletReadService(
      prisma as never,
      llmRuntime as never,
    );

    const result = await service.getMedicineLeafletContext(
      buildContext('阿司匹林'),
    );

    expect(result.coverage.status).toBe('partial');
    expect(result.result['candidates']).toEqual([
      '阿司匹林肠溶片',
      '阿司匹林泡腾片',
    ]);
    expect(result.confidence.level).toBe('low');
  });

  it('returns complete envelope with leaflets and chunks (keyword fallback)', async () => {
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
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'link-1',
            productId: 'prod-1',
            leafletId: 'leaflet-1',
            matchScore: 0.95,
            isBestMatch: true,
            leaflet: {
              id: 'leaflet-1',
              instructionId: 'INS-1',
              genericName: '阿司匹林',
              manufacturer: 'Bayer',
              approvalCodes: ['国药准字H20240001'],
            },
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      medicineLeafletChunk: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'chunk-1',
            leafletId: 'leaflet-1',
            sourceField: 'indications',
            chunkIndex: 0,
            chunkText: '用于预防心脑血管疾病。',
          },
        ]),
        count: jest.fn(),
      },
    });
    const llmRuntime = buildLlmRuntime();
    const service = new AssistantToolLeafletReadService(
      prisma as never,
      llmRuntime as never,
    );

    const result = await service.getMedicineLeafletContext(
      buildContext('阿司匹林肠溶片'),
    );

    expect(result.coverage.status).toBe('complete');
    expect(result.result['medicine']).toMatchObject({
      id: 'prod-1',
      source: 'cn',
      name: '阿司匹林肠溶片',
      manufacturer: 'Bayer',
      approvalNumber: '国药准字H20240001',
    });
    expect(result.result['leaflets']).toEqual([
      {
        id: 'leaflet-1',
        instructionId: 'INS-1',
        genericName: '阿司匹林',
        manufacturer: 'Bayer',
        approvalCodes: ['国药准字H20240001'],
        isBestMatch: true,
        matchScore: 0.95,
      },
    ]);
    expect(result.result['chunks']).toEqual([
      {
        leafletId: 'leaflet-1',
        field: 'indications',
        text: '用于预防心脑血管疾病。',
        rank: 1,
      },
    ]);
    expect(result.source.tool).toBe('get_medicine_leaflet_context');
    expect(result.source.tables).toContain('medicine_leaflet_chunks');
    expect(result.confidence.level).toBe('high');
  });

  it('returns empty coverage when leaflets exist but chunks are missing', async () => {
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
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'link-1',
            productId: 'prod-1',
            leafletId: 'leaflet-1',
            matchScore: 0.95,
            isBestMatch: true,
            leaflet: {
              id: 'leaflet-1',
              instructionId: 'INS-1',
              genericName: '阿司匹林',
              manufacturer: 'Bayer',
              approvalCodes: ['国药准字H20240001'],
            },
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      medicineLeafletChunk: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn(),
      },
    });
    const llmRuntime = buildLlmRuntime();
    const service = new AssistantToolLeafletReadService(
      prisma as never,
      llmRuntime as never,
    );

    const result = await service.getMedicineLeafletContext(
      buildContext('阿司匹林肠溶片'),
    );

    expect(result.coverage.status).toBe('empty');
    expect(result.coverage.reason).toContain('no indexed chunks were found');
    expect(result.result['chunks']).toEqual([]);
  });

  describe('vector search', () => {
    // Minimal mock vector: SWC transformer has issues with large Array literals.
    // The test validates behavior, not vector values.
    const mockEmbedding = [0.01];

    it('uses vector search when embedding is configured', async () => {
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
          findMany: jest.fn(),
          count: jest.fn().mockResolvedValue(1),
        },
        medicineLeafletChunk: {
          findMany: jest.fn(),
          count: jest.fn(),
        },
        $queryRaw: jest.fn().mockResolvedValue([
          {
            id: 'chunk-v1',
            leaflet_id: 'leaflet-1',
            source_field: 'contraindications',
            chunk_text: '对阿司匹林过敏者禁用。',
            chunk_index: 0,
            similarity: 0.92,
          },
          {
            id: 'chunk-v2',
            leaflet_id: 'leaflet-1',
            source_field: 'adverse_reactions',
            chunk_text: '常见胃肠道不适。',
            chunk_index: 1,
            similarity: 0.85,
          },
        ]),
      });
      const llmRuntime = buildLlmRuntime({
        createEmbeddingModel: jest.fn().mockReturnValue({
          embedQuery: jest.fn().mockResolvedValue(mockEmbedding),
        }),
      });
      const service = new AssistantToolLeafletReadService(
        prisma as never,
        llmRuntime as never,
      );

      const result = await service.getMedicineLeafletContext(
        buildContext('阿司匹林伤胃吗'),
      );

      expect(result.coverage.status).toBe('complete');
      expect(result['query']['retrievalMethod']).toBe('vector');
      expect(result.result['chunks']).toEqual([
        {
          leafletId: 'leaflet-1',
          field: 'contraindications',
          text: '对阿司匹林过敏者禁用。',
          rank: 1,
        },
        {
          leafletId: 'leaflet-1',
          field: 'adverse_reactions',
          text: '常见胃肠道不适。',
          rank: 2,
        },
      ]);
    });

    it('falls back to keyword when embedding is not configured', async () => {
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
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'link-1',
              productId: 'prod-1',
              leafletId: 'leaflet-1',
              matchScore: 0.95,
              isBestMatch: true,
              leaflet: {
                id: 'leaflet-1',
                instructionId: 'INS-1',
                genericName: '阿司匹林',
                manufacturer: 'Bayer',
                approvalCodes: ['国药准字H20240001'],
              },
            },
          ]),
          count: jest.fn().mockResolvedValue(1),
        },
        medicineLeafletChunk: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'chunk-1',
              leafletId: 'leaflet-1',
              sourceField: 'indications',
              chunkIndex: 0,
              chunkText: '用于预防心脑血管疾病。',
            },
          ]),
          count: jest.fn(),
        },
      });
      const llmRuntime = buildLlmRuntime({
        createEmbeddingModel: jest.fn().mockReturnValue(null),
      });
      const service = new AssistantToolLeafletReadService(
        prisma as never,
        llmRuntime as never,
      );

      const result = await service.getMedicineLeafletContext(
        buildContext('阿司匹林肠溶片'),
      );

      expect(result['query']['retrievalMethod']).toBe('keyword');
      expect(result.coverage.status).toBe('complete');
    });

    it('falls back to keyword when vector similarity is too low', async () => {
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
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'link-1',
              productId: 'prod-1',
              leafletId: 'leaflet-1',
              matchScore: 0.95,
              isBestMatch: true,
              leaflet: {
                id: 'leaflet-1',
                instructionId: 'INS-1',
                genericName: '阿司匹林',
                manufacturer: 'Bayer',
                approvalCodes: ['国药准字H20240001'],
              },
            },
          ]),
          count: jest.fn().mockResolvedValue(1),
        },
        medicineLeafletChunk: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'chunk-1',
              leafletId: 'leaflet-1',
              sourceField: 'indications',
              chunkIndex: 0,
              chunkText: '用于预防心脑血管疾病。',
            },
          ]),
          count: jest.fn(),
        },
        $queryRaw: jest.fn().mockResolvedValue([
          {
            id: 'chunk-v1',
            leaflet_id: 'leaflet-1',
            source_field: 'contraindications',
            chunk_text: '对阿司匹林过敏者禁用。',
            chunk_index: 0,
            similarity: 0.55,
          },
        ]),
      });
      const llmRuntime = buildLlmRuntime({
        createEmbeddingModel: jest.fn().mockReturnValue({
          embedQuery: jest.fn().mockResolvedValue(mockEmbedding),
        }),
      });
      const service = new AssistantToolLeafletReadService(
        prisma as never,
        llmRuntime as never,
      );

      const result = await service.getMedicineLeafletContext(
        buildContext('阿司匹林肠溶片'),
      );

      expect(result['query']['retrievalMethod']).toBe('keyword');
      expect(result.coverage.status).toBe('complete');
    });
  });
});
