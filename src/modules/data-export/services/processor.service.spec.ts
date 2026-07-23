import { DataExportProcessorService } from './processor.service';
import type { PrismaService } from '../../../prisma';
import type { ReportsService } from '../../reports/dashboard';
import type { DataExportStorageService } from './storage.service';
import type { ReportExportPdfService } from './report-pdf/pdf.service';
import type { NotificationsService } from '../../notifications/services/notifications.service';

type MockPrisma = {
  dataExportRequest: {
    findUnique: vi.Mock;
    update: vi.Mock;
  };
};

type MockReports = { getDashboard: vi.Mock };
type MockStorage = { uploadPdf: vi.Mock };
type MockPdf = {
  buildHospitalPdf: vi.Mock;
  buildMonthlyPdf: vi.Mock;
  buildPrintPdf: vi.Mock;
};
type MockNotifications = { create: vi.Mock };

describe('DataExportProcessorService', () => {
  it('returns early when the export request is not found', async () => {
    const { prisma, processor } = createProcessor();
    prisma.dataExportRequest.findUnique.mockResolvedValue(null);

    await processor.process({
      exportRequestId: 'missing',
      userId: 'user-1',
      language: 'zh-CN',
    });

    expect(prisma.dataExportRequest.findUnique).toHaveBeenCalledWith({
      where: { id: 'missing' },
    });
    expect(prisma.dataExportRequest.update).not.toHaveBeenCalled();
  });

  it('completes a hospital export and stores upload metadata', async () => {
    const { prisma, storageService, reportsService, processor } =
      createProcessor();
    const report = sampleReport();
    reportsService.getDashboard.mockResolvedValue(report as never);
    storageService.uploadPdf.mockResolvedValue({
      objectKey: 'exports/user-1/export.pdf',
      bucket: 'lucent-bucket',
      provider: 'tencent-cos',
      fileSizeBytes: 1024,
    });

    await processor.process({
      exportRequestId: 'export-1',
      userId: 'user-1',
      language: 'zh-CN',
    });

    expect(prisma.dataExportRequest.update).toHaveBeenCalledTimes(2);
    expect(prisma.dataExportRequest.update).toHaveBeenLastCalledWith({
      where: { id: 'export-1' },
      data: {
        status: 'completed',
        objectKey: 'exports/user-1/export.pdf',
        bucket: 'lucent-bucket',
        provider: 'tencent-cos',
        fileName: expect.stringMatching(
          /^lumos-hospital-last_7_days-\d{4}-\d{2}-\d{2}\.pdf$/,
        ),
        fileSizeBytes: 1024,
        completedAt: expect.any(Date),
        errorMessage: null,
      },
    });
    expect(reportsService.getDashboard).toHaveBeenCalledWith(
      'user-1',
      { range: 'last_7_days' },
      'zh-CN',
    );
  });

  it('builds monthly pdf and uses last_30_days range', async () => {
    const { prisma, reportsService, pdfService, processor } = createProcessor();
    prisma.dataExportRequest.findUnique.mockResolvedValue({
      id: 'export-1',
      userId: 'user-1',
      kind: 'monthly',
      format: 'pdf',
      range: 'last_30_days',
      status: 'requested',
    });
    reportsService.getDashboard.mockResolvedValue(sampleReport() as never);

    await processor.process({
      exportRequestId: 'export-1',
      userId: 'user-1',
      language: 'zh-CN',
    });

    expect(reportsService.getDashboard).toHaveBeenCalledWith(
      'user-1',
      { range: 'last_30_days' },
      'zh-CN',
    );
    expect(pdfService.buildMonthlyPdf).toHaveBeenCalledTimes(1);
  });

  it('builds print pdf when kind is print', async () => {
    const { prisma, reportsService, pdfService, processor } = createProcessor();
    prisma.dataExportRequest.findUnique.mockResolvedValue({
      id: 'export-1',
      userId: 'user-1',
      kind: 'print',
      format: 'pdf',
      range: 'last_7_days',
      status: 'requested',
    });
    reportsService.getDashboard.mockResolvedValue(sampleReport() as never);

    await processor.process({
      exportRequestId: 'export-1',
      userId: 'user-1',
      language: 'en',
    });

    expect(pdfService.buildPrintPdf).toHaveBeenCalledTimes(1);
  });

  it('marks the request failed when generation throws and re-throws the error', async () => {
    const { prisma, reportsService, processor } = createProcessor();
    reportsService.getDashboard.mockRejectedValue(new Error('report failed'));

    await expect(
      processor.process({
        exportRequestId: 'export-1',
        userId: 'user-1',
        language: 'zh-CN',
      }),
    ).rejects.toThrow('report failed');

    expect(prisma.dataExportRequest.update).toHaveBeenLastCalledWith({
      where: { id: 'export-1' },
      data: {
        status: 'failed',
        errorMessage: 'report failed',
      },
    });
  });

  it('uses a generic error message when thrown value is not an Error', async () => {
    const { prisma, reportsService, processor } = createProcessor();
    reportsService.getDashboard.mockRejectedValue('unknown failure');

    await expect(
      processor.process({
        exportRequestId: 'export-1',
        userId: 'user-1',
        language: 'zh-CN',
      }),
    ).rejects.toBe('unknown failure');

    expect(prisma.dataExportRequest.update).toHaveBeenLastCalledWith({
      where: { id: 'export-1' },
      data: {
        status: 'failed',
        errorMessage: 'Failed to generate report export',
      },
    });
  });

  it('swallows notification errors so they do not break the export', async () => {
    const { reportsService, notificationsService, processor } =
      createProcessor();
    reportsService.getDashboard.mockResolvedValue(sampleReport() as never);
    notificationsService.create.mockRejectedValue(new Error('notify failed'));

    await expect(
      processor.process({
        exportRequestId: 'export-1',
        userId: 'user-1',
        language: 'zh-CN',
      }),
    ).resolves.toBeUndefined();
  });
});

function createProcessor() {
  const prisma: MockPrisma = {
    dataExportRequest: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'export-1',
        userId: 'user-1',
        kind: 'hospital',
        format: 'pdf',
        range: 'last_7_days',
        status: 'requested',
      }),
      update: vi.fn().mockResolvedValue({}),
    },
  };

  const reportsService: MockReports = {
    getDashboard: vi.fn(),
  };

  const storageService: MockStorage = {
    uploadPdf: vi.fn().mockResolvedValue({
      objectKey: 'exports/user-1/export.pdf',
      bucket: 'lucent-bucket',
      provider: 'tencent-cos',
      fileSizeBytes: 1024,
    }),
  };

  const pdfService: MockPdf = {
    buildHospitalPdf: vi.fn().mockResolvedValue(Buffer.from('pdf')),
    buildMonthlyPdf: vi.fn().mockResolvedValue(Buffer.from('pdf')),
    buildPrintPdf: vi.fn().mockResolvedValue(Buffer.from('pdf')),
  };

  const notificationsService: MockNotifications = {
    create: vi.fn().mockResolvedValue(undefined),
  };

  const processor = new DataExportProcessorService(
    prisma as unknown as PrismaService,
    reportsService as unknown as ReportsService,
    storageService as unknown as DataExportStorageService,
    pdfService as unknown as ReportExportPdfService,
    notificationsService as unknown as NotificationsService,
  );

  return {
    prisma,
    reportsService,
    storageService,
    pdfService,
    notificationsService,
    processor,
  };
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
    metrics: [],
    trends: [],
    findings: [],
    patterns: [],
  };
}
