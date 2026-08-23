import type { DeepMocked } from '../../../common/types/deep-mocked';

import { DataExportService } from './export.service';
import type { PasswordReauthService } from '../../auth';
import type { PrismaService } from '../../../prisma';
import type { DataExportStorageService } from './storage.service';
import type { DataExportQueueService } from './queue.service';
import type { DataExportProcessorService } from './processor.service';
import { errAsync, okAsync } from '../../../common/result';
import type { ResultAsync, DomainFailure } from '../../../common/result';

/** Folds a ResultAsync into a plain outcome so specs can assert code/value. */
async function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

/** Unwraps a ResultAsync, failing the test when it is an Err. */
async function unwrapOk<T>(result: ResultAsync<T, DomainFailure>): Promise<T> {
  const outcome = await collectResult(result);
  if (!outcome.ok) {
    throw new Error(`Expected ok result, got ${outcome.error.code}`);
  }
  return outcome.value;
}

describe('DataExportService', () => {
  let service: DataExportService;
  let prisma: DeepMocked<PrismaService>;
  let storageService: vi.Mocked<DataExportStorageService>;
  let queueService: vi.Mocked<DataExportQueueService>;
  let processor: vi.Mocked<DataExportProcessorService>;
  let passwordReauthService: vi.Mocked<PasswordReauthService>;

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
        .mockReturnValue(okAsync('https://cos.example.com/file')),
    } as unknown as vi.Mocked<DataExportStorageService>;

    queueService = {
      isConfigured: true,
      enqueue: vi.fn().mockResolvedValue(undefined),
    } as unknown as vi.Mocked<DataExportQueueService>;

    processor = {
      process: vi.fn().mockResolvedValue(undefined),
    } as unknown as vi.Mocked<DataExportProcessorService>;

    passwordReauthService = {
      verify: vi.fn().mockReturnValue(okAsync(undefined)),
    } as unknown as vi.Mocked<PasswordReauthService>;

    service = new DataExportService(
      prisma,
      storageService,
      queueService,
      processor,
      passwordReauthService,
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

      const result = await unwrapOk(
        service.createRequest(
          'user-1',
          {
            kind: 'hospital',
            format: 'pdf',
            range: 'last_7_days',
            password: 'Passw0rd123',
          },
          'zh',
        ),
      );

      expect(passwordReauthService.verify).toHaveBeenCalledWith(
        'user-1',
        'Passw0rd123',
      );
      expect(result.status).toBe('unavailable');
      expect(prisma.dataExportRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'unavailable',
            errorMessage: 'Object storage is not configured',
          }),
        }),
      );
      expect(processor.process).not.toHaveBeenCalled();
    });

    it('creates with requested status and enqueues when queue is configured', async () => {
      prisma.dataExportRequest.create.mockResolvedValue(makeRow());

      const result = await unwrapOk(
        service.createRequest(
          'user-1',
          {
            kind: 'hospital',
            format: 'pdf',
            range: 'last_7_days',
            password: 'Passw0rd123',
          },
          'zh',
        ),
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

      const result = await unwrapOk(
        service.createRequest(
          'user-1',
          {
            kind: 'hospital',
            format: 'pdf',
            range: 'last_7_days',
            password: 'Passw0rd123',
          },
          'zh',
        ),
      );

      expect(processor.process).toHaveBeenCalledWith({
        exportRequestId: 'exp-1',
        userId: 'user-1',
        language: 'zh',
      });
      expect(result.status).toBe('completed');
    });

    it('falls back to inline processing when enqueue throws (Redis down)', async () => {
      queueService.enqueue = vi
        .fn()
        .mockRejectedValue(new Error('Redis connection lost'));
      prisma.dataExportRequest.create.mockResolvedValue(makeRow());
      prisma.dataExportRequest.findUniqueOrThrow.mockResolvedValue(
        makeRow({ status: 'completed' }),
      );

      const result = await unwrapOk(
        service.createRequest(
          'user-1',
          {
            kind: 'hospital',
            format: 'pdf',
            range: 'last_7_days',
            password: 'Passw0rd123',
          },
          'zh',
        ),
      );

      expect(queueService.enqueue).toHaveBeenCalledWith({
        exportRequestId: 'exp-1',
        userId: 'user-1',
        language: 'zh',
      });
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

      await unwrapOk(
        service.createRequest(
          'user-1',
          {
            kind: 'monthly',
            format: 'pdf',
            range: 'last_7_days',
            password: 'Passw0rd123',
          },
          'zh',
        ),
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

      await unwrapOk(
        service.createRequest('user-1', { password: 'Passw0rd123' }, 'zh'),
      );

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

    it('returns AUTH_WRONG_PASSWORD when password verification fails', async () => {
      passwordReauthService.verify.mockReturnValue(
        errAsync({
          _tag: 'DomainFailure',
          kind: 'authentication',
          code: 'AUTH_WRONG_PASSWORD',
        } as DomainFailure),
      );

      const outcome = await collectResult(
        service.createRequest(
          'user-1',
          {
            kind: 'hospital',
            format: 'pdf',
            range: 'last_7_days',
            password: 'WrongPass1',
          },
          'zh',
        ),
      );

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('expected failure');
      expect(outcome.error.code).toBe('AUTH_WRONG_PASSWORD');
      expect(prisma.dataExportRequest.create).not.toHaveBeenCalled();
    });

    it('returns AUTH_PASSWORD_NOT_SET for OAuth-only users', async () => {
      passwordReauthService.verify.mockReturnValue(
        errAsync({
          _tag: 'DomainFailure',
          kind: 'authentication',
          code: 'AUTH_PASSWORD_NOT_SET',
        } as DomainFailure),
      );

      const outcome = await collectResult(
        service.createRequest(
          'user-1',
          {
            kind: 'hospital',
            format: 'pdf',
            range: 'last_7_days',
            password: 'AnyPass1',
          },
          'zh',
        ),
      );

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('expected failure');
      expect(outcome.error.code).toBe('AUTH_PASSWORD_NOT_SET');
      expect(prisma.dataExportRequest.create).not.toHaveBeenCalled();
    });
  });

  describe('getLatestRequest', () => {
    it('returns null when no request found', async () => {
      prisma.dataExportRequest.findFirst.mockResolvedValue(null);

      const result = await unwrapOk(service.getLatestRequest('user-1'));

      expect(result).toBeNull();
    });

    it('returns DTO when request found', async () => {
      prisma.dataExportRequest.findFirst.mockResolvedValue(
        makeRow({
          status: 'completed',
          downloadUrl: 'https://cos.example.com/f',
        }),
      );

      const result = await unwrapOk(service.getLatestRequest('user-1'));

      expect(result).not.toBeNull();
      expect(result!.id).toBe('exp-1');
      expect(result!.status).toBe('completed');
      expect(result!.requestedAt).toBe('2026-07-10T08:00:00.000Z');
    });

    it('queries with correct userId and ordering', async () => {
      prisma.dataExportRequest.findFirst.mockResolvedValue(null);

      await unwrapOk(service.getLatestRequest('user-1'));

      expect(prisma.dataExportRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('folds a storage signed-URL failure into DEPENDENCY_UNAVAILABLE', async () => {
      prisma.dataExportRequest.findFirst.mockResolvedValue(
        makeRow({ status: 'completed', objectKey: 'exports/user-1/x.pdf' }),
      );
      storageService.createDownloadUrl.mockReturnValue(
        errAsync({
          _tag: 'DomainFailure',
          kind: 'dependency',
          code: 'DEPENDENCY_UNAVAILABLE',
        } as DomainFailure),
      );

      const outcome = await collectResult(service.getLatestRequest('user-1'));

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    });
  });
});
