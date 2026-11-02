import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { MedicinesController } from './medicines.controller.js';
import { MedicinesService } from '../../application/use_cases/medicines.js';
import { MedicineSearchReadModel } from '../../application/read_models/medicine-card.js';
import { MedicineDetailReadModel } from '../../application/read_models/medicine-detail.js';
import { MedicineSequenceReadModel } from '../../application/read_models/medicine-sequence.js';
import { MedicineRecognitionQueueService } from '../queue/recognition.js';
import { MedicineRiskCheckService } from '../../application/use_cases/check-risk.js';
import { runRiskCheckSchema } from './dto/risk-check.js';
import { recognizeMedicineSchema } from './dto/recognition.js';
import { medicineSearchQuerySchema } from './dto/source.js';
import {
  okAsync,
  DomainFailureException,
} from '../../../../common/result/index.js';
import { I18nService } from 'nestjs-i18n';

describe('MedicinesController', () => {
  let controller: MedicinesController;
  let service: vi.Mocked<MedicinesService>;
  let search: { searchWithCache: ReturnType<typeof vi.fn> };
  let detail: { getWithCache: ReturnType<typeof vi.fn> };
  let sequences: { get: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MedicinesController],
      providers: [
        {
          provide: MedicinesService,
          useValue: {
            getRandomSafetyTips: vi.fn(),
            recognizeMedicine: vi.fn(),
          },
        },
        {
          provide: MedicineSearchReadModel,
          useValue: { searchWithCache: vi.fn(), search: vi.fn() },
        },
        {
          provide: MedicineDetailReadModel,
          useValue: { getWithCache: vi.fn(), get: vi.fn() },
        },
        {
          provide: MedicineSequenceReadModel,
          useValue: { get: vi.fn() },
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
        {
          provide: I18nService,
          useValue: {
            t: vi.fn((key: string) => key),
          },
        },
      ],
    }).compile();

    controller = module.get(MedicinesController);
    service = module.get(MedicinesService);
    search = module.get(MedicineSearchReadModel);
    detail = module.get(MedicineDetailReadModel);
    sequences = module.get(MedicineSequenceReadModel);
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

      expect(result).toEqual(expectedTips);
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
    it('returns items and pagination as a resource', async () => {
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
      search.searchWithCache.mockReturnValue(okAsync(searchResult));

      const result = await controller.search(
        { source: 'drugbank', q: 'ibu', page: 1, pageSize: 20 } as never,
        undefined,
      );

      expect(result).toEqual({
        items: searchResult.items,
        pagination: searchResult.pagination,
      });
      expect(search.searchWithCache).toHaveBeenCalledWith(
        { source: 'drugbank', q: 'ibu', page: 1, pageSize: 20 },
        false,
      );
    });

    it('bypasses cache when header is set to true', async () => {
      search.searchWithCache.mockReturnValue(
        okAsync({
          items: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        }),
      );

      await controller.search(
        { source: 'drugbank', q: 'test', page: 1, pageSize: 20 } as never,
        'true',
      );

      expect(search.searchWithCache).toHaveBeenCalledWith(
        { source: 'drugbank', q: 'test', page: 1, pageSize: 20 },
        true,
      );
    });
  });

  describe('getDetail', () => {
    it('returns the detail resource from the read model', async () => {
      const detailResource = {
        id: 'DB01050',
        source: 'drugbank' as const,
        name: 'Ibuprofen',
        subtitle: null,
        detail: { kind: 'drugbank' as const },
      };
      detail.getWithCache.mockReturnValue(okAsync(detailResource));

      const result = await controller.getDetail(
        'DB01050',
        { source: 'drugbank' },
        undefined,
      );

      expect(result).toEqual(detailResource);
      expect(detail.getWithCache).toHaveBeenCalledWith(
        'DB01050',
        { source: 'drugbank' },
        false,
      );
    });

    it('honours the cache-bypass header on the detail path', async () => {
      detail.getWithCache.mockReturnValue(
        okAsync({ id: 'cn-1', source: 'cn' as const, name: '阿司匹林' }),
      );

      await controller.getDetail('cn-1', {}, '1');

      expect(detail.getWithCache).toHaveBeenCalledWith('cn-1', {}, true);
    });
  });

  describe('getSequences', () => {
    it('returns the sequence resource from the service', async () => {
      const sequenceResource = {
        id: 'DB00002',
        source: 'drugbank' as const,
        drug: [{ description: 'heavy chain', length: 449, sequence: 'QVQLK' }],
        targets: [],
      };
      sequences.get.mockReturnValue(okAsync(sequenceResource));

      const result = await controller.getSequences(
        'DB00002',
        { source: 'drugbank' },
        undefined,
      );

      expect(result).toEqual(sequenceResource);
      expect(sequences.get).toHaveBeenCalledWith(
        'DB00002',
        { source: 'drugbank' },
        false,
      );
    });

    it('honours the cache-bypass header', async () => {
      sequences.get.mockReturnValue(
        okAsync({ id: 'DB00002', source: 'drugbank', drug: [], targets: [] }),
      );

      await controller.getSequences('DB00002', {}, 'no-cache');

      expect(sequences.get).toHaveBeenCalledWith('DB00002', {}, true);
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
      expect(result).toEqual(records);
    });

    it('POST /risk-check dispatches static vs llm by body type', async () => {
      const svc = riskCheckService();
      svc.runStaticCheck.mockReturnValue(okAsync({ checkType: 'static' }));
      svc.runLlmCheck.mockReturnValue(okAsync({ checkType: 'llm' }));

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

      expect(svc.runStaticCheck).toHaveBeenCalledWith('u1', undefined);
      expect(svc.runLlmCheck).toHaveBeenCalledWith('u1');
      expect(svc.runStaticCheck).toHaveBeenCalledTimes(1);
      expect(svc.runLlmCheck).toHaveBeenCalledTimes(1);
    });

    it('POST /risk-check rejects a candidate pre-check with llm type (400)', async () => {
      await expect(
        controller.runRiskCheck(
          { sub: 'u1' } as never,
          {
            type: 'llm',
            candidate: { source: 'cn', id: 'cn-1' },
          } as never,
        ),
      ).rejects.toThrow(DomainFailureException);

      const svc = riskCheckService();
      expect(svc.runLlmCheck).not.toHaveBeenCalled();
      expect(svc.runStaticCheck).not.toHaveBeenCalled();
    });

    it('POST /risk-check forwards the candidate to runStaticCheck', async () => {
      const candidate = { source: 'cn' as const, id: 'cn-1' };
      const svc = riskCheckService();
      svc.runStaticCheck.mockReturnValue(okAsync({ checkType: 'static' }));

      await controller.runRiskCheck(
        { sub: 'u1' } as never,
        { type: 'static', candidate } as never,
      );

      expect(svc.runStaticCheck).toHaveBeenCalledWith('u1', candidate);
    });

    it('POST /risk-check rejects a candidate missing source or id via schema validation (400)', () => {
      // Replaces the former class-validator ValidationPipe metatype test:
      // the DTO is now a zod schema, so the boundary behaviour is asserted
      // against `runRiskCheckSchema` directly.
      for (const candidate of [{ id: 'cn-1' }, { source: 'cn' }]) {
        const parsed = runRiskCheckSchema.safeParse({
          type: 'static',
          candidate,
        });
        expect(parsed.success).toBe(false);
      }
    });

    it('POST /risk-check accepts a full candidate and rejects unknown body keys', () => {
      expect(
        runRiskCheckSchema.safeParse({
          type: 'static',
          candidate: { source: 'cn', id: 'cn-1' },
        }).success,
      ).toBe(true);

      expect(
        runRiskCheckSchema.safeParse({
          type: 'static',
          candidate: { source: 'cn', id: 'cn-1', extra: 1 },
        }).success,
      ).toBe(false);

      expect(
        runRiskCheckSchema.safeParse({ type: 'static', extra: 1 }).success,
      ).toBe(false);
    });
  });

  describe('request DTO schemas (zod)', () => {
    it('search: coerces numeric query strings and applies page defaults', () => {
      const parsed = medicineSearchQuerySchema.parse({
        q: '  ibu  ',
        page: '2',
        pageSize: '30',
      });
      expect(parsed).toEqual({ q: 'ibu', page: 2, pageSize: 30 });

      expect(medicineSearchQuerySchema.parse({})).toEqual({
        page: 1,
        pageSize: 20,
      });
    });

    it('search: trims q and drops non-string q values (@Transform parity)', () => {
      expect(medicineSearchQuerySchema.parse({ q: '  x  ' }).q).toBe('x');

      const dropped = medicineSearchQuerySchema.parse({ q: ['a', 'b'] });
      expect(dropped.q).toBeUndefined();
    });

    it('search: rejects malformed paging and unknown keys (strict, forbid parity)', () => {
      expect(medicineSearchQuerySchema.safeParse({ page: 'abc' }).success).toBe(
        false,
      );
      expect(medicineSearchQuerySchema.safeParse({ page: '' }).success).toBe(
        false,
      );
      expect(medicineSearchQuerySchema.safeParse({ page: 1.5 }).success).toBe(
        false,
      );
      expect(
        medicineSearchQuerySchema.safeParse({ pageSize: 51 }).success,
      ).toBe(false);
      expect(
        medicineSearchQuerySchema.safeParse({ q: 'a'.repeat(201) }).success,
      ).toBe(false);
      expect(
        medicineSearchQuerySchema.safeParse({ source: 'x', q: 'ibu' }).success,
      ).toBe(true);
      expect(
        medicineSearchQuerySchema.safeParse({ unknown: '1' }).success,
      ).toBe(false);
    });

    it('recognize: requires an http(s) imageUrl and rejects unknown keys', () => {
      expect(
        recognizeMedicineSchema.safeParse({
          imageUrl: 'https://example.com/box.jpg',
        }).success,
      ).toBe(true);
      expect(
        recognizeMedicineSchema.safeParse({
          imageUrl: 'http://localhost/test-medicine.jpg',
        }).success,
      ).toBe(true);
      expect(
        recognizeMedicineSchema.safeParse({ imageUrl: 'not-a-url' }).success,
      ).toBe(false);
      expect(recognizeMedicineSchema.safeParse({}).success).toBe(false);
      expect(
        recognizeMedicineSchema.safeParse({
          imageUrl: 'https://example.com/box.jpg',
          extra: 1,
        }).success,
      ).toBe(false);
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
      expect(result).toEqual({ name: '布洛芬' });
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
      expect(result).toEqual({ result: { name: '布洛芬' } });
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
      expect(result).toEqual({ status: 'not_found' });
    });
  });
});
