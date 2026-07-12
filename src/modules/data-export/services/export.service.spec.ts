import type { DeepMocked } from '../../../common/types/deep-mocked';

import { DataExportService } from './export.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { DataExportStorageService } from './storage.service';
import type { DataExportQueueService } from './queue.service';
import type { DataExportProcessorService } from './processor.service';

describe('DataExportService', () => {
  let service: DataExportService;
  let prisma: DeepMocked<PrismaService>;
  let storageService: vi.Mocked<DataExportStorageService>;
  let queueService: vi.Mocked<DataExportQueueService>;
  let processor: vi.Mocked<DataExportProcessorService>;

  beforeEach(() => {
    prisma = {
      dataExportRequest: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
    } as unknown as DeepMocked<PrismaService>;

    storageService = {
      isConfigured: vi.fn().mockReturnValue(true),
      createDownloadUrl: vi
        .fn()
        .mockReturnValue('https://cos.example.com/file'),
    } as unknown as vi.Mocked<DataExportStorageService>;

    queueService = {
      isConfigured: true,
      enqueue: vi.fn().mockResolvedValue(undefined),
    } as unknown as vi.Mocked<DataExportQueueService>;

    processor = {
      process: vi.fn().mockResolvedValue(undefined),
    } as unknown as vi.Mocked<DataExportProcessorService>;

    service = new DataExportService(
      prisma,
      storageService,
      queueService,
      processor,
    );
  });

  function makeRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'exp-1',
      kind: 'hospital',
      format: 'pdf',
      range: 'last_7_days',
      status: 'requested',
      createdAt: new Date('2026-07-10T08:00:00.000Z'),
      completedAt: null,
      downloadUrl: null,
      objectKey: null,
      fileName: null,
      fileSizeBytes: null,
      errorMessage: null,
      ...overrides,
    };
  }

  describe('createRequest', () => {
    it('creates with unavailable status when storage is not configured', async () => {
      storageService.isConfigured.mockReturnValue(false);
      prisma.dataExportRequest.create.mockResolvedValue(
        makeRow({ status: 'unavailable' }),
      );

      const result = await service.createRequest(
        'user-1',
        { kind: 'hospital', format: 'pdf', range: 'last_7_days' },
        'zh',
      );

      expect(result.status).toBe('unavailable');
      expect(prisma.dataExportRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'unavailable',
            errorMessage: 'Tencent COS export storage is not configured',
          }),
        }),
      );
    });

    it('creates with requested status and enqueues when queue is configured', async () => {
      prisma.dataExportRequest.create.mockResolvedValue(makeRow());

      const result = await service.createRequest(
        'user-1',
        { kind: 'hospital', format: 'pdf', range: 'last_7_days' },
        'zh',
      );

      expect(result.status).toBe('requested');
      expect(queueService.enqueue).toHaveBeenCalledWith({
        exportRequestId: 'exp-1',
        userId: 'user-1',
        language: 'zh',
      });
      expect(processor.process).not.toHaveBeenCalled();
    });

    it('falls back to inline processing when queue is not configured', async () => {
      (queueService as { isConfigured: boolean }).isConfigured = false;
      prisma.dataExportRequest.create.mockResolvedValue(makeRow());
      prisma.dataExportRequest.findUniqueOrThrow.mockResolvedValue(
        makeRow({ status: 'completed' }),
      );

      const result = await service.createRequest(
        'user-1',
        { kind: 'hospital', format: 'pdf', range: 'last_7_days' },
        'zh',
      );

      expect(processor.process).toHaveBeenCalledWith({
        exportRequestId: 'exp-1',
        userId: 'user-1',
        language: 'zh',
      });
      expect(result.status).toBe('completed');
    });

    it('overrides range to last_30_days for monthly kind', async () => {
      prisma.dataExportRequest.create.mockResolvedValue(
        makeRow({ kind: 'monthly', range: 'last_30_days' }),
      );

      await service.createRequest(
        'user-1',
        { kind: 'monthly', format: 'pdf', range: 'last_7_days' },
        'zh',
      );

      expect(prisma.dataExportRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'monthly',
            range: 'last_30_days',
          }),
        }),
      );
    });

    it('uses default values when dto fields are undefined', async () => {
      prisma.dataExportRequest.create.mockResolvedValue(makeRow());

      await service.createRequest('user-1', {}, 'zh');

      expect(prisma.dataExportRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'hospital',
            format: 'pdf',
            range: 'last_7_days',
          }),
        }),
      );
    });
  });

  describe('getLatestRequest', () => {
    it('returns null when no request found', async () => {
      prisma.dataExportRequest.findFirst.mockResolvedValue(null);

      const result = await service.getLatestRequest('user-1');

      expect(result).toBeNull();
    });

    it('returns DTO when request found', async () => {
      prisma.dataExportRequest.findFirst.mockResolvedValue(
        makeRow({
          status: 'completed',
          downloadUrl: 'https://cos.example.com/f',
        }),
      );

      const result = await service.getLatestRequest('user-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('exp-1');
      expect(result!.status).toBe('completed');
      expect(result!.requestedAt).toBe('2026-07-10T08:00:00.000Z');
    });

    it('queries with correct userId and ordering', async () => {
      prisma.dataExportRequest.findFirst.mockResolvedValue(null);

      await service.getLatestRequest('user-1');

      expect(prisma.dataExportRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });
  });
});
