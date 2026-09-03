import { Test, type TestingModule } from '@nestjs/testing';
import { DailyRecordsController } from './daily-records.controller.js';
import { DailyRecordCandidatesService } from './services/candidates/orchestrator.service.js';
import { DailyRecordImageUploadService } from './services/image-upload.service.js';
import { DailyRecordsService } from './services/records.service.js';
import type { UserPayload } from '../auth/index.js';
import { okAsync, errAsync } from '../../common/result/index.js';
import type { DomainFailure } from '../../common/result/index.js';

describe('DailyRecordsController', () => {
  let controller: DailyRecordsController;
  let dailyRecordsService: vi.Mocked<DailyRecordsService>;
  let candidatesService: vi.Mocked<DailyRecordCandidatesService>;
  let imageUploadService: vi.Mocked<DailyRecordImageUploadService>;

  const mockUser: UserPayload = {
    sub: 'user-1',
    email: 'test@example.com',
    status: 'active',
  };

  const forbiddenFailure: DomainFailure = {
    _tag: 'DomainFailure',
    kind: 'authorization',
    code: 'FORBIDDEN',
  };
  const notFoundFailure: DomainFailure = {
    _tag: 'DomainFailure',
    kind: 'not_found',
    code: 'RESOURCE_NOT_FOUND',
  };

  beforeEach(async () => {
    dailyRecordsService = {
      list: vi.fn(),
      summary: vi.fn(),
      get: vi.fn().mockReturnValue(okAsync({ id: 'rec-1' })),
      create: vi.fn().mockReturnValue(okAsync({ id: 'rec-1' })),
      update: vi.fn().mockReturnValue(okAsync({ id: 'rec-1' })),
      delete: vi.fn().mockReturnValue(okAsync(undefined)),
    } as unknown as vi.Mocked<DailyRecordsService>;

    candidatesService = {
      generate: vi.fn(),
    } as unknown as vi.Mocked<DailyRecordCandidatesService>;

    imageUploadService = {
      createPresignedUpload: vi.fn(),
    } as unknown as vi.Mocked<DailyRecordImageUploadService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DailyRecordsController],
      providers: [
        { provide: DailyRecordsService, useValue: dailyRecordsService },
        { provide: DailyRecordCandidatesService, useValue: candidatesService },
        {
          provide: DailyRecordImageUploadService,
          useValue: imageUploadService,
        },
      ],
    }).compile();

    controller = module.get(DailyRecordsController);
  });

  describe('list', () => {
    it('calls service.list with correct params', async () => {
      const data = { items: [], total: 0, page: 1, pageSize: 50 };
      dailyRecordsService.list.mockResolvedValue(data);

      const result = await controller.list(mockUser, {
        date: '2026-07-10',
      });

      expect(dailyRecordsService.list).toHaveBeenCalledWith(
        'user-1',
        '2026-07-10',
        undefined,
        1,
        50,
      );
      expect(result).toEqual(data);
    });

    it('passes kind, page, pageSize when provided', async () => {
      dailyRecordsService.list.mockResolvedValue({
        items: [],
        total: 0,
        page: 2,
        pageSize: 10,
      } as never);

      await controller.list(mockUser, {
        date: '2026-07-10',
        kind: 'water',
        page: 2,
        pageSize: 10,
      });

      expect(dailyRecordsService.list).toHaveBeenCalledWith(
        'user-1',
        '2026-07-10',
        'water',
        2,
        10,
      );
    });
  });

  describe('summary', () => {
    it('calls service.summary with userId and date', async () => {
      const data = { date: '2026-07-10', counts: {} } as never;
      dailyRecordsService.summary.mockResolvedValue(data);

      const result = await controller.summary(mockUser, '2026-07-10');

      expect(dailyRecordsService.summary).toHaveBeenCalledWith(
        'user-1',
        '2026-07-10',
      );
      expect(result).toEqual(data);
    });
  });

  describe('createImageUpload', () => {
    it('calls imageUploadService.createPresignedUpload', async () => {
      const dto = {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 1024,
      } as never;
      const data = {
        uploadUrl: 'https://cos.example.com',
        objectKey: 'key-1',
      } as never;
      imageUploadService.createPresignedUpload.mockResolvedValue(data);

      const result = await controller.createImageUpload(mockUser, dto);

      expect(imageUploadService.createPresignedUpload).toHaveBeenCalledWith(
        'user-1',
        dto,
      );
      expect(result).toEqual(data);
    });
  });

  describe('generateCandidates', () => {
    it('calls candidatesService.generate with dto and language', async () => {
      const dto = { note: '喝了一杯水', date: '2026-07-10' } as never;
      const data = {
        confirmationHint: 'Did you drink water?',
        items: [],
      } as never;
      candidatesService.generate.mockResolvedValue(data);

      const result = await controller.generateCandidates(
        mockUser,
        dto,
        'zh-CN',
      );

      expect(candidatesService.generate).toHaveBeenCalledWith(
        'user-1',
        dto,
        'zh-CN',
      );
      expect(result).toEqual(data);
    });
  });

  describe('get', () => {
    it('calls service.get with userId and id', async () => {
      const data = { id: 'rec-1', kind: 'water', value: '500' } as never;
      dailyRecordsService.get.mockReturnValue(okAsync(data));

      const result = await controller.get(mockUser, 'rec-1');

      expect(dailyRecordsService.get).toHaveBeenCalledWith('user-1', 'rec-1');
      expect(result).toEqual(data);
    });

    it('folds a foreign record into DomainFailureException with FORBIDDEN', async () => {
      dailyRecordsService.get.mockReturnValue(errAsync(forbiddenFailure));

      await expect(
        controller.get(mockUser, 'rec-foreign'),
      ).rejects.toMatchObject({
        failure: { kind: 'authorization', code: 'FORBIDDEN' },
      });
    });

    it('folds a missing record into DomainFailureException with RESOURCE_NOT_FOUND', async () => {
      dailyRecordsService.get.mockReturnValue(errAsync(notFoundFailure));

      await expect(
        controller.get(mockUser, 'rec-missing'),
      ).rejects.toMatchObject({
        failure: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });
  });

  describe('create', () => {
    it('calls service.create with userId and dto', async () => {
      const dto = { kind: 'water', value: '500', unit: 'ml' } as never;
      const data = {
        id: 'rec-1',
        kind: 'water',
        value: '500',
        unit: 'ml',
      } as never;
      dailyRecordsService.create.mockReturnValue(okAsync(data));

      const result = await controller.create(mockUser, dto);

      expect(dailyRecordsService.create).toHaveBeenCalledWith('user-1', dto);
      expect(result).toEqual(data);
    });

    it('folds a validation failure into DomainFailureException', async () => {
      const dto = { kind: 'sleep', payload: {} } as never;
      const validationFailure: DomainFailure = {
        _tag: 'DomainFailure',
        kind: 'validation',
        code: 'VALIDATION_FAILED',
      };
      dailyRecordsService.create.mockReturnValue(errAsync(validationFailure));

      await expect(controller.create(mockUser, dto)).rejects.toMatchObject({
        failure: { kind: 'validation', code: 'VALIDATION_FAILED' },
      });
    });
  });

  describe('update', () => {
    it('calls service.update with userId, id, and dto', async () => {
      const dto = { value: '600' };
      const data = { id: 'rec-1', kind: 'water', value: '600' } as never;
      dailyRecordsService.update.mockReturnValue(okAsync(data));

      const result = await controller.update(mockUser, 'rec-1', dto);

      expect(dailyRecordsService.update).toHaveBeenCalledWith(
        'user-1',
        'rec-1',
        dto,
      );
      expect(result).toEqual(data);
    });

    it('folds a missing record into DomainFailureException with RESOURCE_NOT_FOUND', async () => {
      dailyRecordsService.update.mockReturnValue(errAsync(notFoundFailure));

      await expect(
        controller.update(mockUser, 'rec-missing', {}),
      ).rejects.toMatchObject({
        failure: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });
  });

  describe('delete', () => {
    it('calls service.delete with userId and id and returns no body', async () => {
      await expect(
        controller.delete(mockUser, 'rec-1'),
      ).resolves.toBeUndefined();

      expect(dailyRecordsService.delete).toHaveBeenCalledWith(
        'user-1',
        'rec-1',
      );
    });

    it('folds a foreign record into DomainFailureException with FORBIDDEN', async () => {
      dailyRecordsService.delete.mockReturnValue(errAsync(forbiddenFailure));

      await expect(
        controller.delete(mockUser, 'rec-foreign'),
      ).rejects.toMatchObject({
        failure: { kind: 'authorization', code: 'FORBIDDEN' },
      });
    });
  });
});
