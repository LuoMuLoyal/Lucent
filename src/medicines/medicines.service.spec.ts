import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { MedicinesService } from './medicines.service';
import { MedicinesCacheService } from './cache/medicines-cache.service';
import { CnMedicinesService } from './sources/cn-medicines.service';
import { DrugbankMedicinesService } from './sources/drugbank-medicines.service';
import { ResultCode } from '../common/api-envelope';

describe('MedicinesService', () => {
  let service: MedicinesService;
  let drugbankMedicinesService: jest.Mocked<DrugbankMedicinesService>;
  let cnMedicinesService: jest.Mocked<CnMedicinesService>;
  let medicinesCacheService: jest.Mocked<MedicinesCacheService>;

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
      ],
    }).compile();

    service = module.get(MedicinesService);
    drugbankMedicinesService = module.get(DrugbankMedicinesService);
    cnMedicinesService = module.get(CnMedicinesService);
    medicinesCacheService = module.get(MedicinesCacheService);
  });

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
});
