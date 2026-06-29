import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { MedicinesService } from './medicines.service';
import { MedicinesCacheService } from './cache/medicines-cache.service';
import { CnMedicinesService } from './sources/cn-medicines.service';
import { DrugbankMedicinesService } from './sources/drugbank-medicines.service';
import { ResultCode } from '../../common/api-envelope';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmRuntimeService } from '../llm-runtime/llm-runtime.service';

describe('MedicinesService', () => {
  let service: MedicinesService;
  let drugbankMedicinesService: jest.Mocked<DrugbankMedicinesService>;
  let cnMedicinesService: jest.Mocked<CnMedicinesService>;
  let medicinesCacheService: jest.Mocked<MedicinesCacheService>;
  let prismaService: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MedicinesService,
        {
          provide: DrugbankMedicinesService,
          useValue: {
            search: jest.fn(),
            getDetail: jest.fn(),
          },
        },
        {
          provide: CnMedicinesService,
          useValue: {
            search: jest.fn(),
            getDetail: jest.fn(),
          },
        },
        {
          provide: MedicinesCacheService,
          useValue: {
            getOrSetSearch: jest.fn(),
            getOrSetDetail: jest.fn(),
          },
        },
        {
          provide: I18nService,
          useValue: {
            t: jest.fn((key: string) => key),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            medicineSafetyTip: {
              findMany: jest.fn(),
            },
          },
        },
        {
          provide: LlmRuntimeService,
          useValue: {
            createChatModel: jest.fn().mockReturnValue({
              invoke: jest.fn().mockResolvedValue({ content: '{}' }),
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
    prismaService.medicineSafetyTip.findMany as jest.Mock;

  afterEach(() => {
    jest.restoreAllMocks();
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

    await expect(
      service.search({
        q: ' ibuprofen ',
        page: 1,
        pageSize: 20,
      }),
    ).resolves.toEqual(expectedResult);

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

    await service.search({
      source: 'cn',
      q: '布洛芬',
      page: 2,
      pageSize: 10,
    });

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
      service.search({
        source: 'raw-db',
        q: 'ibuprofen',
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.search({
        source: 'raw-db',
        q: 'ibuprofen',
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toMatchObject({
      response: {
        code: ResultCode.BAD_REQUEST,
        message: 'medicine.source_invalid',
      },
    });
  });

  it('should throw not found when the selected source has no detail record', async () => {
    drugbankMedicinesService.getDetail.mockResolvedValue(null);
    medicinesCacheService.getOrSetDetail.mockImplementation(
      async (_source, _id, _bypass, load) => load(),
    );

    await expect(
      service.getDetail('DB00001', { source: 'drugbank' }),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.getDetail('DB00001', { source: 'drugbank' }),
    ).rejects.toMatchObject({
      response: {
        code: ResultCode.NOT_FOUND,
        message: 'medicine.not_found',
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

    await expect(
      service.getDetail(' DB01050 ', { source: 'drugbank' }),
    ).resolves.toEqual(expectedDetail);

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

      const result = await service.getRandomSafetyTips([], 'zh-CN');

      expect(result).toHaveLength(4);
      expect(result[0]?.text).toMatch(/^中文/);
      expect(getSafetyTipsFindManyMock()).toHaveBeenCalledWith({
        where: { isActive: true },
      });
    });

    it('returns tips in English when language does not start with zh', async () => {
      getSafetyTipsFindManyMock().mockResolvedValue(tips);

      const result = await service.getRandomSafetyTips([], 'en');

      expect(result).toHaveLength(4);
      expect(result[0]?.text).toMatch(/^EN/);
    });

    it('excludes previously returned tip ids', async () => {
      getSafetyTipsFindManyMock().mockResolvedValue(tips);

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

      const result = await service.getRandomSafetyTips([]);

      expect(result).toHaveLength(0);
    });
  });
});
