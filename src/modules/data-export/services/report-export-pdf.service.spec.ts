/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { PDFDocument } from 'pdf-lib';
import { ReportExportPdfService } from './report-export-pdf.service';

const mockChartService = {
  buildTrendChart: jest.fn().mockResolvedValue(null),
  buildScoreChart: jest.fn().mockResolvedValue(null),
} as any;

describe('ReportExportPdfService', () => {
  const service = new ReportExportPdfService(mockChartService);

  it('builds a multi-page hospital pdf with metadata', async () => {
    const pdfBytes = await service.buildHospitalPdf({
      locale: 'zh-CN',
      report: sampleReport({ findingsCount: 60, patternsCount: 40 }),
    });

    const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });

    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(pdf.getTitle()).toBe('Lumos 医疗就诊报告');
    expect(pdf.getAuthor()).toBe('Lumos / Lucent');
    expect(pdf.getSubject()).toContain('统计范围 2026-06-09 ~ 2026-06-15');
    expect(pdf.getCreator()).toBe('Lucent Report Export Service');
    expect(pdf.getProducer()).toBe('Lucent Report Export Service');
    expect(pdf.getCreationDate()?.toISOString()).toBe(
      '2026-06-15T09:30:00.000Z',
    );
    expect(pdf.getModificationDate()?.toISOString()).toBe(
      '2026-06-15T09:30:00.000Z',
    );
  }, 30000);

  it('builds a single-page english print pdf with metadata', async () => {
    const pdfBytes = await service.buildPrintPdf({
      locale: 'en',
      report: sampleReport({ findingsCount: 1, patternsCount: 2 }),
    });

    const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });

    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(pdf.getTitle()).toBe('Lumos Print Report');
    expect(pdf.getSubject()).toContain('range 2026-06-09 ~ 2026-06-15');
    expect(pdf.getAuthor()).toBe('Lumos / Lucent');
  }, 30000);
});

function sampleReport(input?: {
  findingsCount?: number;
  patternsCount?: number;
}) {
  const findingsCount = input?.findingsCount ?? 1;
  const patternsCount = input?.patternsCount ?? 1;

  return {
    range: 'last_7_days' as const,
    startDate: '2026-06-09',
    endDate: '2026-06-15',
    generatedAt: '2026-06-15T09:30:00.000Z',
    aiSummaryEnabled: true,
    score: {
      value: 78,
      maxValue: 100,
      status: 'stable' as const,
      summary:
        '过去 7 天整体稳定，饮水仍需加强。过去 7 天整体稳定，饮水仍需加强。过去 7 天整体稳定，饮水仍需加强。',
    },
    metrics: [
      {
        kind: 'medication' as const,
        value: '92',
        unit: '%',
        status: 'good' as const,
        delta: '+5%',
        direction: 'up' as const,
        sparkline: [90, 95, 93, 92, 91, 94, 92],
      },
      {
        kind: 'water' as const,
        value: '1.4',
        unit: 'L',
        status: 'needs_attention' as const,
        delta: '-0.2',
        direction: 'down' as const,
        sparkline: [1.8, 1.6, 1.3, 1.2, 1.5, 1.4, 1.4],
      },
      {
        kind: 'sleep' as const,
        value: '6.5',
        unit: 'h',
        status: 'stable' as const,
        delta: '+0.3',
        direction: 'up' as const,
        sparkline: [6.2, 6.1, 6.4, 6.5, 6.8, 6.4, 6.5],
      },
    ],
    trends: [],
    findings: Array.from({ length: findingsCount }, (_, index) => ({
      kind: 'hydration' as const,
      title: `饮水偏低 ${String(index + 1)}`,
      body: '过去 7 天有 4 天饮水低于 1.5L，需要尽快恢复到白天主动补水的节奏，并结合服药时间做提醒。',
    })),
    patterns: Array.from({ length: patternsCount }, (_, index) => ({
      kind: 'hydration' as const,
      title: `饮水模式 ${String(index + 1)}`,
      status: 'needs_attention' as const,
      body: '晚间补水较多，白天补水不足，说明当前行为模式仍然偏被动，建议把补水动作前移到上午和午后。',
      sparkline: [1.8, 1.6, 1.3, 1.2, 1.5, 1.4, 1.4],
    })),
  };
}
