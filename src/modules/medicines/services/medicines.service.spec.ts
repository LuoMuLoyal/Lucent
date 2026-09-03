import type { DeepMocked } from '../../../common/types/deep-mocked.js';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { I18nService } from 'nestjs-i18n';

import { MedicinesService } from './medicines.service.js';
import { MedicinesCacheService } from '../cache/store.service.js';
import { CnMedicinesService } from '../adapters/cn.service.js';
import { DrugbankMedicinesService } from '../adapters/drugbank.service.js';
import { PrismaService } from '../../../prisma/index.js';
import { LlmRuntimeService } from '../../../llm-runtime/index.js';
import {
  DomainFailureException,
  unwrapResult,
} from '../../../common/result/index.js';

describe('MedicinesService', () => {
  let service: MedicinesService;
  let drugbankMedicinesService: vi.Mocked<DrugbankMedicinesService>;
  let cnMedicinesService: vi.Mocked<CnMedicinesService>;
  let medicinesCacheService: vi.Mocked<MedicinesCacheService>;
  let prismaService: DeepMocked<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MedicinesService,
        {
          provide: DrugbankMedicinesService,
          useValue: {
            search: vi.fn(),
            getDetail: vi.fn(),
          },
        },
        {
          provide: CnMedicinesService,
          useValue: {
            search: vi.fn(),
            getDetail: vi.fn(),
          },
        },
        {
          provide: MedicinesCacheService,
          useValue: {
            getOrSetSearch: vi.fn(),
            getOrSetDetail: vi.fn(),
            getOrSetSafetyTips: vi.fn(),
          },
        },
        {
          provide: I18nService,
          useValue: {
            t: vi.fn((key: string) => key),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            medicineSafetyTip: {
              findMany: vi.fn(),
            },
          },
        },
        {
          provide: LlmRuntimeService,
          useValue: {
            createChatModel: vi.fn().mockReturnValue({
              invoke: vi.fn().mockResolvedValue({ content: '{}' }),
            }),
          },
        },
      ],
    }).compile();

    service = module.get(MedicinesService);
    drugbankMedicinesService = module.get(DrugbankMedicinesService);
    cnMedicinesService = module.get(CnMedicinesService);
    medicinesCacheService = module.get(MedicinesCacheService);
    prismaService = module.get(PrismaService);
  });

  const getSafetyTipsFindManyMock = () =>
    prismaService.medicineSafetyTip.findMany as vi.Mock;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should default search source to drugbank', async () => {
    const expectedResult = {
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    };
    drugbankMedicinesService.search.mockResolvedValue(expectedResult);
    medicinesCacheService.getOrSetSearch.mockImplementation(
      async (_input, _bypass, load) => load(),
    );

    const result = await unwrapResult(
      service.search({
        q: ' ibuprofen ',
        page: 1,
        pageSize: 20,
      }),
    );
    expect(result).toEqual(expectedResult);

    expect(medicinesCacheService.getOrSetSearch).toHaveBeenCalledWith(
      {
        source: 'drugbank',
        q: 'ibuprofen',
        page: 1,
        pageSize: 20,
      },
      false,
      expect.any(Function),
    );
    expect(drugbankMedicinesService.search).toHaveBeenCalledWith({
      q: 'ibuprofen',
      page: 1,
      pageSize: 20,
    });
    expect(cnMedicinesService.search).not.toHaveBeenCalled();
  });

  it('should route explicit cn source to the cn reader', async () => {
    const expectedResult = {
      items: [],
      pagination: { page: 2, pageSize: 10, total: 0, totalPages: 0 },
    };
    cnMedicinesService.search.mockResolvedValue(expectedResult);
    medicinesCacheService.getOrSetSearch.mockImplementation(
      async (_input, _bypass, load) => load(),
    );

    await unwrapResult(
      service.search({
        source: 'cn',
        q: '布洛芬',
        page: 2,
        pageSize: 10,
      }),
    );

    expect(medicinesCacheService.getOrSetSearch).toHaveBeenCalledWith(
      {
        source: 'cn',
        q: '布洛芬',
        page: 2,
        pageSize: 10,
      },
      false,
      expect.any(Function),
    );
    expect(cnMedicinesService.search).toHaveBeenCalledWith({
      q: '布洛芬',
      page: 2,
      pageSize: 10,
    });
    expect(drugbankMedicinesService.search).not.toHaveBeenCalled();
  });

  it('should reject unsupported source values', async () => {
    await expect(
      unwrapResult(
        service.search({
          source: 'raw-db',
          q: 'ibuprofen',
          page: 1,
          pageSize: 20,
        }),
      ),
    ).rejects.toThrow(DomainFailureException);

    await expect(
      unwrapResult(
        service.search({
          source: 'raw-db',
          q: 'ibuprofen',
          page: 1,
          pageSize: 20,
        }),
      ),
    ).rejects.toMatchObject({
      failure: {
        kind: 'validation',
        code: 'VALIDATION_FAILED',
        detail: 'medicine.source_invalid',
      },
    });
  });

  it('should throw not found when the selected source has no detail record', async () => {
    drugbankMedicinesService.getDetail.mockResolvedValue(null);
    medicinesCacheService.getOrSetDetail.mockImplementation(
      async (_source, _id, _bypass, load) => load(),
    );

    await expect(
      unwrapResult(service.getDetail('DB00001', { source: 'drugbank' })),
    ).rejects.toThrow(DomainFailureException);

    await expect(
      unwrapResult(service.getDetail('DB00001', { source: 'drugbank' })),
    ).rejects.toMatchObject({
      failure: {
        kind: 'not_found',
        code: 'RESOURCE_NOT_FOUND',
        detail: 'medicine.not_found',
      },
    });
  });

  it('should resolve detail through the cache service before hitting the source reader', async () => {
    const expectedDetail = {
      id: 'DB01050',
      source: 'drugbank' as const,
      name: 'Ibuprofen',
      subtitle: 'CAS 15687-27-1',
      detail: {
        kind: 'drugbank' as const,
        drugType: null,
        state: null,
        description: null,
        indication: null,
        mechanismOfAction: null,
        pharmacodynamics: null,
        toxicity: null,
        metabolism: null,
        absorption: null,
        halfLife: null,
        proteinBinding: null,
        routeOfElimination: null,
        volumeOfDistribution: null,
        clearance: null,
        groups: [],
        categories: [],
        atcCodes: [],
        synonyms: [],
        foodInteractions: [],
        drugInteractions: null,
        externalIdentifiers: null,
        externalLinks: null,
      },
    };
    drugbankMedicinesService.getDetail.mockResolvedValue(expectedDetail);
    medicinesCacheService.getOrSetDetail.mockImplementation(
      async (_source, _id, _bypass, load) => load(),
    );

    const result = await unwrapResult(
      service.getDetail(' DB01050 ', { source: 'drugbank' }),
    );
    expect(result).toEqual(expectedDetail);

    expect(medicinesCacheService.getOrSetDetail).toHaveBeenCalledWith(
      'drugbank',
      'DB01050',
      false,
      expect.any(Function),
    );
    expect(drugbankMedicinesService.getDetail).toHaveBeenCalledWith('DB01050');
  });

  describe('getRandomSafetyTips', () => {
    const tips = [
      {
        id: 'id-1',
        contentZh: '中文 1',
        contentEn: 'EN 1',
        category: 'alcohol',
        sortOrder: 1,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'id-2',
        contentZh: '中文 2',
        contentEn: 'EN 2',
        category: 'caffeine',
        sortOrder: 2,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'id-3',
        contentZh: '中文 3',
        contentEn: 'EN 3',
        category: 'timing',
        sortOrder: 3,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'id-4',
        contentZh: '中文 4',
        contentEn: 'EN 4',
        category: 'storage',
        sortOrder: 4,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'id-5',
        contentZh: '中文 5',
        contentEn: 'EN 5',
        category: 'food',
        sortOrder: 5,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'id-6',
        contentZh: '中文 6',
        contentEn: 'EN 6',
        category: 'general',
        sortOrder: 6,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    it('returns up to 4 random active tips in Chinese', async () => {
      getSafetyTipsFindManyMock().mockResolvedValue(tips);
      medicinesCacheService.getOrSetSafetyTips.mockImplementation(
        async (load) => load(),
      );

      const result = await service.getRandomSafetyTips([], 'zh-CN');

      expect(result).toHaveLength(4);
      expect(result[0]?.text).toMatch(/^中文/);
      expect(getSafetyTipsFindManyMock()).toHaveBeenCalledWith({
        where: { isActive: true },
      });
    });

    it('returns tips in English when language does not start with zh', async () => {
      getSafetyTipsFindManyMock().mockResolvedValue(tips);
      medicinesCacheService.getOrSetSafetyTips.mockImplementation(
        async (load) => load(),
      );

      const result = await service.getRandomSafetyTips([], 'en');

      expect(result).toHaveLength(4);
      expect(result[0]?.text).toMatch(/^EN/);
    });

    it('excludes previously returned tip ids', async () => {
      getSafetyTipsFindManyMock().mockResolvedValue(tips);
      medicinesCacheService.getOrSetSafetyTips.mockImplementation(
        async (load) => load(),
      );

      const result = await service.getRandomSafetyTips([
        'id-1',
        'id-2',
        'id-3',
        'id-4',
      ]);

      const returnedIds = result.map((tip) => tip.id);
      expect(returnedIds).not.toContain('id-1');
      expect(returnedIds).not.toContain('id-2');
      expect(returnedIds).not.toContain('id-3');
      expect(returnedIds).not.toContain('id-4');
      expect(result).toHaveLength(2);
    });

    it('returns remaining tips when excluded ids leave fewer than 4', async () => {
      getSafetyTipsFindManyMock().mockResolvedValue(tips);
      medicinesCacheService.getOrSetSafetyTips.mockImplementation(
        async (load) => load(),
      );

      const result = await service.getRandomSafetyTips([
        'id-1',
        'id-2',
        'id-3',
        'id-4',
        'id-5',
      ]);

      const returnedIds = result.map((tip) => tip.id);
      expect(returnedIds).not.toContain('id-1');
      expect(returnedIds).not.toContain('id-2');
      expect(returnedIds).not.toContain('id-3');
      expect(returnedIds).not.toContain('id-4');
      expect(returnedIds).not.toContain('id-5');
      expect(result).toHaveLength(1);
    });

    it('returns empty array when no active tips exist', async () => {
      getSafetyTipsFindManyMock().mockResolvedValue([]);
      medicinesCacheService.getOrSetSafetyTips.mockImplementation(
        async (load) => load(),
      );

      const result = await service.getRandomSafetyTips([]);

      expect(result).toHaveLength(0);
    });
  });
});
