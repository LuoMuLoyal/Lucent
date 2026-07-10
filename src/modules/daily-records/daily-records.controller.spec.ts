import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode } from '../../common/api';
import { DailyRecordsController } from './daily-records.controller';
import { DailyRecordCandidatesService } from './services/candidates/candidates.service';
import { DailyRecordImageUploadService } from './services/image-upload.service';
import { DailyRecordsService } from './services/records.service';
import type { UserPayload } from '../auth/services/auth.service';

describe('DailyRecordsController', () => {
  let controller: DailyRecordsController;
  let dailyRecordsService: jest.Mocked<DailyRecordsService>;
  let candidatesService: jest.Mocked<DailyRecordCandidatesService>;
  let imageUploadService: jest.Mocked<DailyRecordImageUploadService>;

  const mockUser: UserPayload = { sub: 'user-1', email: 'test@example.com' };

  beforeEach(async () => {
    dailyRecordsService = {
      list: jest.fn(),
      summary: jest.fn(),
      get: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<DailyRecordsService>;

    candidatesService = {
      generate: jest.fn(),
    } as unknown as jest.Mocked<DailyRecordCandidatesService>;

    imageUploadService = {
      createPresignedUpload: jest.fn(),
    } as unknown as jest.Mocked<DailyRecordImageUploadService>;

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
        kind: undefined,
        page: undefined,
        pageSize: undefined,
      });

      expect(dailyRecordsService.list).toHaveBeenCalledWith(
        'user-1',
        '2026-07-10',
        undefined,
        1,
        50,
      );
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data,
      });
    });

    it('passes kind, page, pageSize when provided', async () => {
      dailyRecordsService.list.mockResolvedValue({
        items: [],
        total: 0,
        page: 2,
        pageSize: 10,
      });

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
      const data = { date: '2026-07-10', counts: {} };
      dailyRecordsService.summary.mockResolvedValue(data);

      const result = await controller.summary(mockUser, '2026-07-10');

      expect(dailyRecordsService.summary).toHaveBeenCalledWith(
        'user-1',
        '2026-07-10',
      );
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data,
      });
    });
  });

  describe('createImageUpload', () => {
    it('calls imageUploadService.createPresignedUpload', () => {
      const dto = { filename: 'test.jpg', contentType: 'image/jpeg' };
      const data = { uploadUrl: 'https://cos.example.com', objectKey: 'key-1' };
      imageUploadService.createPresignedUpload.mockReturnValue(data);

      const result = controller.createImageUpload(mockUser, dto);

      expect(imageUploadService.createPresignedUpload).toHaveBeenCalledWith(
        'user-1',
        dto,
      );
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data,
      });
    });
  });

  describe('generateCandidates', () => {
    it('calls candidatesService.generate with dto and language', async () => {
      const dto = { note: '喝了一杯水', date: '2026-07-10' };
      const data = { confirmationHint: 'Did you drink water?', items: [] };
      candidatesService.generate.mockResolvedValue(data);

      const result = await controller.generateCandidates(
        mockUser,
        dto,
        'zh-CN',
      );

      expect(candidatesService.generate).toHaveBeenCalledWith(dto, 'zh-CN');
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data,
      });
    });
  });

  describe('get', () => {
    it('calls service.get with userId and id', async () => {
      const data = { id: 'rec-1', kind: 'water', value: '500' };
      dailyRecordsService.get.mockResolvedValue(data);

      const result = await controller.get(mockUser, 'rec-1');

      expect(dailyRecordsService.get).toHaveBeenCalledWith('user-1', 'rec-1');
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data,
      });
    });
  });

  describe('create', () => {
    it('calls service.create with userId and dto', async () => {
      const dto = { kind: 'water', value: '500', unit: 'ml' };
      const data = { id: 'rec-1', ...dto };
      dailyRecordsService.create.mockResolvedValue(data);

      const result = await controller.create(mockUser, dto);

      expect(dailyRecordsService.create).toHaveBeenCalledWith('user-1', dto);
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data,
      });
    });
  });

  describe('update', () => {
    it('calls service.update with userId, id, and dto', async () => {
      const dto = { value: '600' };
      const data = { id: 'rec-1', kind: 'water', value: '600' };
      dailyRecordsService.update.mockResolvedValue(data);

      const result = await controller.update(mockUser, 'rec-1', dto);

      expect(dailyRecordsService.update).toHaveBeenCalledWith(
        'user-1',
        'rec-1',
        dto,
      );
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data,
      });
    });
  });

  describe('delete', () => {
    it('calls service.delete with userId and id', async () => {
      dailyRecordsService.delete.mockResolvedValue(undefined);

      const result = await controller.delete(mockUser, 'rec-1');

      expect(dailyRecordsService.delete).toHaveBeenCalledWith(
        'user-1',
        'rec-1',
      );
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: null,
      });
    });
  });
});
