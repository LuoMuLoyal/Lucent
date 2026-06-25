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
    medicineLeafletChunk?: { findMany: jest.Mock; count: jest.Mock };
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
    const service = new AssistantToolLeafletReadService(prisma as never);

    await expect(service.hasIndexedChunks()).resolves.toBe(true);
    expect(prisma.medicineLeafletChunk.count).toHaveBeenCalledWith({ take: 1 });
  });

  it('returns an empty envelope for empty user message', async () => {
    const prisma = buildPrisma();
    const service = new AssistantToolLeafletReadService(prisma as never);

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
    const service = new AssistantToolLeafletReadService(prisma as never);

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
    const service = new AssistantToolLeafletReadService(prisma as never);

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
    const service = new AssistantToolLeafletReadService(prisma as never);

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

  it('returns complete envelope with leaflets and chunks', async () => {
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
    const service = new AssistantToolLeafletReadService(prisma as never);

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
    const service = new AssistantToolLeafletReadService(prisma as never);

    const result = await service.getMedicineLeafletContext(
      buildContext('阿司匹林肠溶片'),
    );

    expect(result.coverage.status).toBe('empty');
    expect(result.coverage.reason).toContain('no indexed chunks were found');
    expect(result.result['chunks']).toEqual([]);
  });
});
