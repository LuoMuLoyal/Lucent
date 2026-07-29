import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { MedicinesController } from './medicines.controller';
import { MedicinesService } from './services/medicines.service';
import { MedicineRecognitionQueueService } from './services/medicine-recognition-queue.service';
import { MedicineRiskCheckService } from './services/risk-check.service';

describe('MedicinesController', () => {
  let controller: MedicinesController;
  let service: vi.Mocked<MedicinesService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MedicinesController],
      providers: [
        {
          provide: MedicinesService,
          useValue: {
            searchWithCache: vi.fn(),
            getDetailWithCache: vi.fn(),
            getRandomSafetyTips: vi.fn(),
          },
        },
        {
          provide: MedicineRecognitionQueueService,
          useValue: {
            isConfigured: false,
            enqueue: vi.fn(),
            getStatus: vi.fn(),
          },
        },
        {
          provide: MedicineRiskCheckService,
          useValue: {
            getRecords: vi.fn(),
            runStaticCheck: vi.fn(),
            runLlmCheck: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(MedicinesController);
    service = module.get(MedicinesService);
  });

  describe('getSafetyTips', () => {
    it('returns safety tips from the service', async () => {
      const expectedTips = [
        { id: 'tip-1', text: '提示 1', category: 'alcohol' },
        { id: 'tip-2', text: '提示 2', category: 'caffeine' },
        { id: 'tip-3', text: '提示 3', category: 'timing' },
        { id: 'tip-4', text: '提示 4', category: 'storage' },
      ];
      service.getRandomSafetyTips.mockResolvedValue(expectedTips);

      const result = await controller.getSafetyTips(undefined, 'zh-CN');

      expect(result).toEqual({
        code: 0,
        message: '',
        data: expectedTips,
      });
      expect(service.getRandomSafetyTips).toHaveBeenCalledWith([], 'zh-CN');
    });

    it('normalizes a single exclude value to an array', async () => {
      service.getRandomSafetyTips.mockResolvedValue([]);

      await controller.getSafetyTips('tip-1', 'en');

      expect(service.getRandomSafetyTips).toHaveBeenCalledWith(['tip-1'], 'en');
    });

    it('passes array exclude values as-is', async () => {
      service.getRandomSafetyTips.mockResolvedValue([]);

      await controller.getSafetyTips(['tip-1', 'tip-2'], 'en');

      expect(service.getRandomSafetyTips).toHaveBeenCalledWith(
        ['tip-1', 'tip-2'],
        'en',
      );
    });
  });

  describe('search', () => {
    it('returns a standard envelope with items and pagination in data', async () => {
      const searchResult = {
        items: [
          {
            id: 'DB01050',
            source: 'drugbank' as const,
            name: 'Ibuprofen',
            subtitle: 'CAS 15687-27-1',
            summary: 'A non-steroidal anti-inflammatory drug.',
            tags: ['approved', 'small molecule'],
            imageUrl: null,
            matchedBy: ['name'],
          },
        ],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      };
      service.searchWithCache.mockResolvedValue(searchResult);

      const result = await controller.search(
        { source: 'drugbank', q: 'ibu', page: 1, pageSize: 20 } as never,
        undefined,
      );

      expect(result).toEqual({
        code: 0,
        message: '',
        data: {
          items: searchResult.items,
          pagination: searchResult.pagination,
        },
      });
      expect(service.searchWithCache).toHaveBeenCalledWith(
        { source: 'drugbank', q: 'ibu', page: 1, pageSize: 20 },
        false,
      );
    });

    it('bypasses cache when header is set to true', async () => {
      service.searchWithCache.mockResolvedValue({
        items: [],
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      });

      await controller.search(
        { source: 'drugbank', q: 'test', page: 1, pageSize: 20 } as never,
        'true',
      );

      expect(service.searchWithCache).toHaveBeenCalledWith(
        { source: 'drugbank', q: 'test', page: 1, pageSize: 20 },
        true,
      );
    });
  });
});
