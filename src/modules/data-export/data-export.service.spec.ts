import type { DeepMocked } from '../../common/types/deep-mocked';
import type { PrismaService } from '../../prisma/prisma.service';
import { DataExportService } from './services/export.service';
import type { DataExportStorageService } from './services/storage.service';
import type { DataExportQueueService } from './services/queue.service';
import type { DataExportProcessorService } from './services/processor.service';
import type { DataExportProcessorInput } from './services/processor.service';

describe('DataExportService', () => {
  it('marks the request unavailable when COS storage is not configured', async () => {
    const prisma = prismaDouble();
    const storageService = {
      isConfigured: vi.fn().mockReturnValue(false),
      createDownloadUrl: vi.fn().mockReturnValue(null),
      uploadPdf: vi.fn(),
    } as unknown as DataExportStorageService;
    const queueService = {
      isConfigured: false,
      enqueue: vi.fn(),
    } as unknown as DataExportQueueService;
    const processor = {
      process: vi.fn(),
    } as unknown as DataExportProcessorService;
    const service = new DataExportService(
      prisma,
      storageService,
      queueService,
      processor,
    );

    const result = await service.createRequest(
      'user-1',
      { kind: 'hospital', format: 'pdf', range: 'last_7_days' },
      'zh-CN',
    );

    expect(result.status).toBe('unavailable');
    expect(result.kind).toBe('hospital');
    expect(result.format).toBe('pdf');
    expect(result.range).toBe('last_7_days');
    expect(prisma.dataExportRequest.create).toHaveBeenCalledTimes(1);
    expect(storageService.uploadPdf).not.toHaveBeenCalled();
    expect(processor.process).not.toHaveBeenCalled();
  });

  it('delegates inline processing to DataExportProcessorService when queue is unavailable', async () => {
    const prisma = prismaDouble();
    const storageService = {
      isConfigured: vi.fn().mockReturnValue(true),
      createDownloadUrl: vi
        .fn()
        .mockReturnValue('https://download.example.com/export.pdf'),
    } as unknown as DataExportStorageService;
    const queueService = {
      isConfigured: false,
      enqueue: vi.fn(),
    } as unknown as DataExportQueueService;
    const processor = {
      process: vi.fn().mockImplementation(async () => {
        await prisma.dataExportRequest.update({
          where: { id: 'export-1' },
          data: {
            status: 'completed',
            objectKey: 'exports/user-1/export.pdf',
            bucket: 'lucent-bucket',
            provider: 'tencent-cos',
            fileName: 'lumos-hospital-last_7_days-2026-06-15.pdf',
            fileSizeBytes: 2048,
            completedAt: new Date('2026-06-15T09:31:00.000Z'),
          },
        });
      }),
    } as unknown as DataExportProcessorService;
    const service = new DataExportService(
      prisma,
      storageService,
      queueService,
      processor,
    );

    const result = await service.createRequest(
      'user-1',
      { kind: 'hospital', format: 'pdf', range: 'last_7_days' },
      'zh-CN',
    );

    expect(processor.process).toHaveBeenCalledWith({
      exportRequestId: 'export-1',
      userId: 'user-1',
      language: 'zh-CN',
    } as DataExportProcessorInput);
    expect(prisma.dataExportRequest.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'export-1' },
    });
    expect(result.status).toBe('completed');
    expect(result.downloadUrl).toBe('https://download.example.com/export.pdf');
    expect(result.fileName).toMatch(
      /^lumos-hospital-last_7_days-\d{4}-\d{2}-\d{2}\.pdf$/,
    );
    expect(result.fileSizeBytes).toBe(2048);
  });

  it('returns the created request immediately when queue is configured', async () => {
    const prisma = prismaDouble();
    const storageService = {
      isConfigured: vi.fn().mockReturnValue(true),
      createDownloadUrl: vi.fn().mockReturnValue(null),
    } as unknown as DataExportStorageService;
    const queueService = {
      isConfigured: true,
      enqueue: vi.fn().mockResolvedValue(undefined),
    } as unknown as DataExportQueueService;
    const processor = {
      process: vi.fn(),
    } as unknown as DataExportProcessorService;
    const service = new DataExportService(
      prisma,
      storageService,
      queueService,
      processor,
    );

    const result = await service.createRequest(
      'user-1',
      { kind: 'hospital', format: 'pdf', range: 'last_7_days' },
      'zh-CN',
    );

    expect(queueService.enqueue).toHaveBeenCalledWith({
      exportRequestId: 'export-1',
      userId: 'user-1',
      language: 'zh-CN',
    });
    expect(processor.process).not.toHaveBeenCalled();
    expect(result.status).toBe('requested');
    expect(result.id).toBe('export-1');
  });

  it('completes a monthly pdf export with last_30_days range', async () => {
    const prisma = prismaDouble();
    const storageService = {
      isConfigured: vi.fn().mockReturnValue(true),
      createDownloadUrl: vi
        .fn()
        .mockReturnValue('https://download.example.com/monthly.pdf'),
    } as unknown as DataExportStorageService;
    const queueService = {
      isConfigured: false,
      enqueue: vi.fn(),
    } as unknown as DataExportQueueService;
    const processor = {
      process: vi.fn().mockImplementation(async () => {
        await prisma.dataExportRequest.update({
          where: { id: 'export-1' },
          data: {
            status: 'completed',
            objectKey: 'exports/user-1/monthly.pdf',
            fileName: 'lumos-monthly-last_30_days-2026-06-15.pdf',
            fileSizeBytes: 3072,
            completedAt: new Date('2026-06-15T09:31:00.000Z'),
          },
        });
      }),
    } as unknown as DataExportProcessorService;
    const service = new DataExportService(
      prisma,
      storageService,
      queueService,
      processor,
    );

    const result = await service.createRequest(
      'user-1',
      { kind: 'monthly', format: 'pdf', range: 'last_7_days' },
      'zh-CN',
    );

    expect(result.status).toBe('completed');
    expect(result.range).toBe('last_30_days');
    expect(result.fileName).toMatch(
      /^lumos-monthly-last_30_days-\d{4}-\d{2}-\d{2}\.pdf$/,
    );
  });

  it('stores the normalized monthly range on the created request row', async () => {
    const prisma = prismaDouble();
    const storageService = {
      isConfigured: vi.fn().mockReturnValue(true),
      createDownloadUrl: vi.fn().mockReturnValue(null),
    } as unknown as DataExportStorageService;
    const queueService = {
      isConfigured: false,
      enqueue: vi.fn(),
    } as unknown as DataExportQueueService;
    const processor = {
      process: vi.fn().mockResolvedValue(undefined),
    } as unknown as DataExportProcessorService;
    const service = new DataExportService(
      prisma,
      storageService,
      queueService,
      processor,
    );

    await service.createRequest(
      'user-1',
      { kind: 'monthly', format: 'pdf', range: 'last_7_days' },
      'zh-CN',
    );

    const lastCreateData = (
      prisma as unknown as {
        __lastCreateData: () => Record<string, unknown> | null;
      }
    ).__lastCreateData();
    expect(lastCreateData).toBeDefined();
    if (!lastCreateData) {
      throw new Error('Expected createRequest to persist a request row');
    }

    expect(lastCreateData['kind']).toBe('monthly');
    expect(lastCreateData['range']).toBe('last_30_days');
  });
});

function prismaDouble(): DeepMocked<PrismaService> {
  const createdAt = new Date('2026-06-15T09:30:00.000Z');

  const makeRow = (
    overrides: Partial<{
      kind: string;
      range: string;
      status: string;
      fileName: string | null;
      fileSizeBytes: number | null;
      errorMessage: string | null;
      objectKey: string | null;
      bucket: string | null;
      provider: string | null;
      downloadUrl: string | null;
    }> = {},
  ) => ({
    id: 'export-1',
    userId: 'user-1',
    kind: overrides.kind ?? 'hospital',
    format: 'pdf',
    range: overrides.range ?? 'last_7_days',
    status: overrides.status ?? 'requested',
    objectKey: overrides.objectKey ?? null,
    bucket: overrides.bucket ?? null,
    provider: overrides.provider ?? null,
    fileName: overrides.fileName ?? null,
    fileSizeBytes: overrides.fileSizeBytes ?? null,
    completedAt:
      overrides.status === 'completed'
        ? new Date('2026-06-15T09:31:00.000Z')
        : null,
    downloadUrl: overrides.downloadUrl ?? null,
    errorMessage: overrides.errorMessage ?? null,
    createdAt,
    updatedAt: createdAt,
  });

  let currentRow = makeRow();
  let lastCreateData: Record<string, unknown> | null = null;

  const create = vi
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      lastCreateData = data;
      currentRow = { ...currentRow, ...data };
      return currentRow;
    });

  const update = vi
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      currentRow = { ...currentRow, ...data };
      return currentRow;
    });

  const findUniqueOrThrow = vi.fn().mockImplementation(() => currentRow);

  const prisma = {
    dataExportRequest: {
      create,
      update,
      findFirst: vi.fn(),
      findUniqueOrThrow,
    },
  } as unknown as DeepMocked<PrismaService>;

  Object.defineProperty(prisma, '__lastCreateData', {
    value: () => lastCreateData,
  });

  return prisma;
}
