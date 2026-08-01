import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { MedicinesController } from './medicines.controller';
import { MedicinesService } from './services/medicines.service';
import { MedicineRecognitionQueueService } from './services/recognition-queue.service';
import { MedicineRiskCheckService } from './services/risk/risk-check.service';

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
            recognizeMedicine: vi.fn(),
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

  describe('risk-check endpoints', () => {
    const riskCheckService = () =>
      (
        controller as unknown as {
          riskCheckService: {
            getRecords: ReturnType<typeof vi.fn>;
            runStaticCheck: ReturnType<typeof vi.fn>;
            runLlmCheck: ReturnType<typeof vi.fn>;
          };
        }
      ).riskCheckService;

    it('GET /risk-check returns records from the service', async () => {
      const records = { static: null, llm: null };
      riskCheckService().getRecords.mockResolvedValue(records);

      const result = await controller.getRiskCheck({ sub: 'u1' } as never);

      expect(riskCheckService().getRecords).toHaveBeenCalledWith('u1');
      expect(result).toEqual({ code: 0, message: '', data: records });
    });

    it('POST /risk-check dispatches static vs llm by body type', async () => {
      await controller.runRiskCheck(
        { sub: 'u1' } as never,
        {
          type: 'static',
        } as never,
      );
      await controller.runRiskCheck(
        { sub: 'u1' } as never,
        {
          type: 'llm',
        } as never,
      );

      const svc = riskCheckService();
      expect(svc.runStaticCheck).toHaveBeenCalledWith('u1');
      expect(svc.runLlmCheck).toHaveBeenCalledWith('u1');
      expect(svc.runStaticCheck).toHaveBeenCalledTimes(1);
      expect(svc.runLlmCheck).toHaveBeenCalledTimes(1);
    });
  });

  describe('recognize endpoints', () => {
    it('POST /recognize delegates to the medicines service', async () => {
      service.recognizeMedicine.mockResolvedValue({
        name: '布洛芬',
      } as never);

      const result = await controller.recognize(
        { sub: 'u1' } as never,
        {
          imageUrl: 'https://example.com/box.jpg',
        } as never,
      );

      expect(service.recognizeMedicine).toHaveBeenCalledWith(
        'https://example.com/box.jpg',
      );
      expect(result).toEqual({
        code: 0,
        message: '',
        data: { name: '布洛芬' },
      });
    });

    it('POST /recognize/async falls back to synchronous recognize when queue is not configured', async () => {
      service.recognizeMedicine.mockResolvedValue({
        name: '布洛芬',
      } as never);

      const result = await controller.recognizeAsync(
        { sub: 'u1' } as never,
        {
          imageUrl: 'https://example.com/box.jpg',
        } as never,
      );

      expect(service.recognizeMedicine).toHaveBeenCalledWith(
        'https://example.com/box.jpg',
      );
      expect(result).toEqual({
        code: 0,
        message: '',
        data: { result: { name: '布洛芬' } },
      });
    });

    it('GET /recognize/status/:jobId returns not_found when the job is unknown', async () => {
      const queue = (
        controller as unknown as {
          recognitionQueueService: {
            getStatus: ReturnType<typeof vi.fn>;
          };
        }
      ).recognitionQueueService;
      queue.getStatus.mockResolvedValue(null);

      const result = await controller.recognizeStatus(
        { sub: 'u1' } as never,
        'job-1',
      );

      expect(queue.getStatus).toHaveBeenCalledWith('job-1', 'u1');
      expect(result).toEqual({
        code: 0,
        message: '',
        data: { status: 'not_found' },
      });
    });
  });
});
