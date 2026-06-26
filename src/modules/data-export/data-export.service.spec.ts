import type { PrismaService } from '../../prisma/prisma.service';
import type { ReportsService } from '../reports/dashboard/reports.service';
import { DataExportService } from './data-export.service';
import type { DataExportStorageService } from './services/data-export-storage.service';
import type { ReportExportPdfService } from './services/report-export-pdf.service';
import type { NotificationsService } from '../notifications/notifications.service';

describe('DataExportService', () => {
  it('marks the request unavailable when COS storage is not configured', async () => {
    const prisma = prismaDouble();
    const reportsService = {
      getDashboard: jest.fn(),
    } as unknown as ReportsService;
    const storageService = {
      isConfigured: jest.fn().mockReturnValue(false),
      createDownloadUrl: jest.fn().mockReturnValue(null),
      uploadPdf: jest.fn(),
    } as unknown as DataExportStorageService;
    const pdfService = {
      buildHospitalPdf: jest.fn(),
    } as unknown as ReportExportPdfService;
    const notificationsService = {
      create: jest.fn(),
    } as unknown as NotificationsService;
    const service = new DataExportService(
      prisma,
      reportsService,
      storageService,
      pdfService,
      notificationsService,
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
    expect(prisma.dataExportRequest.update).toHaveBeenCalledTimes(1);
    expect(storageService.uploadPdf).not.toHaveBeenCalled();
  });

  it('completes a hospital pdf export and returns a signed download url', async () => {
    const prisma = prismaDouble();
    const reportsService = {
      getDashboard: jest.fn().mockResolvedValue(sampleReport()),
    } as unknown as ReportsService;
    const storageService = {
      isConfigured: jest.fn().mockReturnValue(true),
      createDownloadUrl: jest
        .fn()
        .mockReturnValue('https://download.example.com/export.pdf'),
      uploadPdf: jest.fn().mockResolvedValue({
        objectKey: 'exports/user-1/2026/06/15/export.pdf',
        bucket: 'lucent-1250000000',
        provider: 'tencent-cos',
        fileSizeBytes: 2048,
      }),
    } as unknown as DataExportStorageService;
    const pdfService = {
      buildHospitalPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
    } as unknown as ReportExportPdfService;
    const notificationsService = {
      create: jest.fn(),
    } as unknown as NotificationsService;
    const service = new DataExportService(
      prisma,
      reportsService,
      storageService,
      pdfService,
      notificationsService,
    );

    const result = await service.createRequest(
      'user-1',
      { kind: 'hospital', format: 'pdf', range: 'last_7_days' },
      'zh-CN',
    );

    expect(result.status).toBe('completed');
    expect(result.downloadUrl).toBe('https://download.example.com/export.pdf');
    expect(result.fileName).toMatch(
      /^lumos-hospital-last_7_days-\d{4}-\d{2}-\d{2}\.pdf$/,
    );
    expect(result.fileSizeBytes).toBe(2048);
    expect(reportsService.getDashboard).toHaveBeenCalledWith(
      'user-1',
      { range: 'last_7_days' },
      'zh-CN',
    );
    expect(pdfService.buildHospitalPdf).toHaveBeenCalledTimes(1);
    expect(storageService.uploadPdf).toHaveBeenCalledTimes(1);
    expect(prisma.dataExportRequest.update).toHaveBeenCalledTimes(2);
  });

  it('marks the request failed when export generation throws', async () => {
    const prisma = prismaDouble();
    const reportsService = {
      getDashboard: jest.fn().mockRejectedValue(new Error('report failed')),
    } as unknown as ReportsService;
    const storageService = {
      isConfigured: jest.fn().mockReturnValue(true),
      createDownloadUrl: jest.fn().mockReturnValue(null),
      uploadPdf: jest.fn(),
    } as unknown as DataExportStorageService;
    const pdfService = {
      buildHospitalPdf: jest.fn(),
    } as unknown as ReportExportPdfService;
    const notificationsService = {
      create: jest.fn(),
    } as unknown as NotificationsService;
    const service = new DataExportService(
      prisma,
      reportsService,
      storageService,
      pdfService,
      notificationsService,
    );

    const result = await service.createRequest(
      'user-1',
      { kind: 'hospital', format: 'pdf', range: 'last_7_days' },
      'zh-CN',
    );

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('report failed');
    expect(storageService.uploadPdf).not.toHaveBeenCalled();
  });

  it('completes a monthly pdf export with last_30_days range', async () => {
    const prisma = prismaDouble();
    const reportsService = {
      getDashboard: jest.fn().mockResolvedValue(sampleReport()),
    } as unknown as ReportsService;
    const storageService = {
      isConfigured: jest.fn().mockReturnValue(true),
      createDownloadUrl: jest
        .fn()
        .mockReturnValue('https://download.example.com/monthly.pdf'),
      uploadPdf: jest.fn().mockResolvedValue({
        objectKey: 'exports/user-1/2026/06/15/monthly.pdf',
        bucket: 'lucent-1250000000',
        provider: 'tencent-cos',
        fileSizeBytes: 3072,
      }),
    } as unknown as DataExportStorageService;
    const pdfService = {
      buildHospitalPdf: jest.fn(),
      buildMonthlyPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
      buildPrintPdf: jest.fn(),
    } as unknown as ReportExportPdfService;
    const notificationsService = {
      create: jest.fn(),
    } as unknown as NotificationsService;
    const service = new DataExportService(
      prisma,
      reportsService,
      storageService,
      pdfService,
      notificationsService,
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
    expect(reportsService.getDashboard).toHaveBeenCalledWith(
      'user-1',
      { range: 'last_30_days' },
      'zh-CN',
    );
    expect(pdfService.buildMonthlyPdf).toHaveBeenCalledTimes(1);
    expect(pdfService.buildHospitalPdf).not.toHaveBeenCalled();
  });

  it('completes a print pdf export', async () => {
    const prisma = prismaDouble();
    const reportsService = {
      getDashboard: jest.fn().mockResolvedValue(sampleReport()),
    } as unknown as ReportsService;
    const storageService = {
      isConfigured: jest.fn().mockReturnValue(true),
      createDownloadUrl: jest
        .fn()
        .mockReturnValue('https://download.example.com/print.pdf'),
      uploadPdf: jest.fn().mockResolvedValue({
        objectKey: 'exports/user-1/2026/06/15/print.pdf',
        bucket: 'lucent-1250000000',
        provider: 'tencent-cos',
        fileSizeBytes: 2560,
      }),
    } as unknown as DataExportStorageService;
    const pdfService = {
      buildHospitalPdf: jest.fn(),
      buildMonthlyPdf: jest.fn(),
      buildPrintPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
    } as unknown as ReportExportPdfService;
    const notificationsService = {
      create: jest.fn(),
    } as unknown as NotificationsService;
    const service = new DataExportService(
      prisma,
      reportsService,
      storageService,
      pdfService,
      notificationsService,
    );

    const result = await service.createRequest(
      'user-1',
      { kind: 'print', format: 'pdf', range: 'last_7_days' },
      'en',
    );

    expect(result.status).toBe('completed');
    expect(result.fileName).toMatch(
      /^lumos-print-last_7_days-\d{4}-\d{2}-\d{2}\.pdf$/,
    );
    expect(pdfService.buildPrintPdf).toHaveBeenCalledTimes(1);
  });

  it('stores the normalized monthly range on the created request row', async () => {
    const prisma = prismaDouble();
    const reportsService = {
      getDashboard: jest.fn().mockResolvedValue(sampleReport()),
    } as unknown as ReportsService;
    const storageService = {
      isConfigured: jest.fn().mockReturnValue(true),
      createDownloadUrl: jest
        .fn()
        .mockReturnValue('https://download.example.com/monthly.pdf'),
      uploadPdf: jest.fn().mockResolvedValue({
        objectKey: 'exports/user-1/2026/06/15/monthly.pdf',
        bucket: 'lucent-1250000000',
        provider: 'tencent-cos',
        fileSizeBytes: 3072,
      }),
    } as unknown as DataExportStorageService;
    const pdfService = {
      buildHospitalPdf: jest.fn(),
      buildMonthlyPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
      buildPrintPdf: jest.fn(),
    } as unknown as ReportExportPdfService;
    const notificationsService = {
      create: jest.fn(),
    } as unknown as NotificationsService;
    const service = new DataExportService(
      prisma,
      reportsService,
      storageService,
      pdfService,
      notificationsService,
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

function prismaDouble(): jest.Mocked<PrismaService> {
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

  const create = jest
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      lastCreateData = data;
      currentRow = { ...currentRow, ...data };
      return currentRow;
    });

  const update = jest
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      currentRow = { ...currentRow, ...data };
      return currentRow;
    });

  const prisma = {
    dataExportRequest: {
      create,
      update,
      findFirst: jest.fn(),
    },
  } as unknown as jest.Mocked<PrismaService>;

  Object.defineProperty(prisma, '__lastCreateData', {
    value: () => lastCreateData,
  });

  return prisma;
}

function sampleReport() {
  return {
    range: 'last_7_days',
    startDate: '2026-06-09',
    endDate: '2026-06-15',
    generatedAt: '2026-06-15T09:30:00.000Z',
    aiSummaryEnabled: true,
    score: {
      value: 78,
      maxValue: 100,
      status: 'stable',
      summary: '过去 7 天整体稳定，饮水仍需加强。',
    },
    metrics: [
      {
        kind: 'medication',
        value: '92',
        unit: '%',
        status: 'good',
        delta: '+5%',
        direction: 'up',
        sparkline: [90, 95, 93, 92, 91, 94, 92],
      },
      {
        kind: 'water',
        value: '1.4',
        unit: 'L',
        status: 'needs_attention',
        delta: '-0.2',
        direction: 'down',
        sparkline: [1.8, 1.6, 1.3, 1.2, 1.5, 1.4, 1.4],
      },
    ],
    trends: [],
    findings: [
      {
        kind: 'hydration',
        title: '饮水偏低',
        body: '过去 7 天有 4 天饮水低于 1.5L。',
      },
    ],
    patterns: [
      {
        kind: 'hydration',
        title: '饮水模式',
        status: 'needs_attention',
        body: '晚间补水较多，白天补水不足。',
        sparkline: [1.8, 1.6, 1.3, 1.2, 1.5, 1.4, 1.4],
      },
    ],
  };
}
