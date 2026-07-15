import { Test, type TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ResultCode } from '../../common/api';
import {
  REPORT_RANGE_CUSTOM,
  REPORT_RANGE_LAST_30_DAYS,
  REPORT_RANGE_LAST_7_DAYS,
  type ReportDashboardDataDto,
  type ReportSummaryDataDto,
} from './dto';
import { ReportsAiSummaryService } from './services/ai-summary/summary.service';
import { ReportSummaryQueueService } from './services/ai-summary/summary-queue.service';
import { ClinicSummaryService } from './services/clinic-summary/summary.service';
import { ClinicSummaryPdfQueueService } from './services/clinic-summary/pdf-queue.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './dashboard/dashboard.service';

describe('ReportsController', () => {
  let controller: ReportsController;
  let service: vi.Mocked<ReportsService>;
  let aiSummaryService: vi.Mocked<ReportsAiSummaryService>;
  let clinicSummaryService: vi.Mocked<ClinicSummaryService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        {
          provide: ReportsService,
          useValue: {
            getDashboard: vi.fn(),
          },
        },
        {
          provide: ReportsAiSummaryService,
          useValue: {
            generate: vi.fn(),
            generateStream: vi.fn(),
          },
        },
        {
          provide: ClinicSummaryService,
          useValue: {
            buildClinicSummary: vi.fn(),
            createShareLink: vi.fn(),
            getSharedSummary: vi.fn(),
            exportPdf: vi.fn(),
            exportSharedPdf: vi.fn(),
          },
        },
        {
          provide: ReportSummaryQueueService,
          useValue: {
            isConfigured: false,
            enqueue: vi.fn(),
            getStatus: vi.fn(),
          },
        },
        {
          provide: ClinicSummaryPdfQueueService,
          useValue: {
            isConfigured: false,
            enqueue: vi.fn(),
            getStatus: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(ReportsController);
    service = module.get(ReportsService);
    aiSummaryService = module.get(ReportsAiSummaryService);
    clinicSummaryService = module.get(ClinicSummaryService);
  });

  // ── getDashboard ──────────────────────────────────────────────────────

  it('should return report dashboard envelope', async () => {
    const dashboard = makeDashboard();
    service.getDashboard.mockResolvedValue(dashboard);

    expect(
      await controller.getDashboard(
        { sub: 'u1', email: 'a@b.c', status: 'active' },
        { range: REPORT_RANGE_LAST_7_DAYS },
        'en',
      ),
    ).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: dashboard,
    });
    expect(service.getDashboard).toHaveBeenCalledWith(
      'u1',
      { range: REPORT_RANGE_LAST_7_DAYS },
      'en',
    );
  });

  it('should pass custom range dates to dashboard service', async () => {
    const dashboard = makeDashboard({
      range: REPORT_RANGE_CUSTOM,
      startDate: '2026-06-01',
      endDate: '2026-06-10',
    });
    service.getDashboard.mockResolvedValue(dashboard);

    expect(
      await controller.getDashboard(
        { sub: 'u1', email: 'a@b.c', status: 'active' },
        {
          range: REPORT_RANGE_CUSTOM,
          startDate: '2026-06-01',
          endDate: '2026-06-10',
        },
        'en',
      ),
    ).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: dashboard,
    });
    expect(service.getDashboard).toHaveBeenCalledWith(
      'u1',
      {
        range: REPORT_RANGE_CUSTOM,
        startDate: '2026-06-01',
        endDate: '2026-06-10',
      },
      'en',
    );
  });

  // ── generateSummary ───────────────────────────────────────────────────

  it('should return report summary envelope', async () => {
    const summary = makeSummary();
    aiSummaryService.generate.mockResolvedValue(summary);

    expect(
      await controller.generateSummary(
        { sub: 'u1', email: 'a@b.c', status: 'active' },
        { range: REPORT_RANGE_LAST_30_DAYS },
        'zh-CN',
      ),
    ).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: summary,
    });
    expect(aiSummaryService.generate).toHaveBeenCalledWith(
      'u1',
      {
        range: REPORT_RANGE_LAST_30_DAYS,
      },
      'zh-CN',
    );
  });

  // ── generateSummaryStream ─────────────────────────────────────────────

  it('writes SSE events for summary, result, and done on success', async () => {
    const summaryResult = makeSummary();
    aiSummaryService.generateStream.mockImplementation(
      async (_userId, _dto, _lang, onSummary) => {
        await onSummary({ summary: 'partial text' });
        return summaryResult;
      },
    );

    const events: Array<{ event: string; data: unknown }> = [];
    const reply = makeMockReply(events);

    await controller.generateSummaryStream(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { range: REPORT_RANGE_LAST_30_DAYS },
      'zh-CN',
      reply,
    );

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain('summary');
    expect(eventTypes).toContain('result');
    expect(eventTypes).toContain('done');

    const summaryEvent = events.find((e) => e.event === 'summary')!;
    expect(summaryEvent.data).toEqual({ summary: 'partial text' });

    const resultEvent = events.find((e) => e.event === 'result')!;
    expect(resultEvent.data).toEqual(summaryResult);

    expect(reply.raw.end).toHaveBeenCalled();
  });

  it('writes SSE error event when service throws', async () => {
    aiSummaryService.generateStream.mockRejectedValue(new Error('LLM down'));

    const events: Array<{ event: string; data: unknown }> = [];
    const reply = makeMockReply(events);

    await controller.generateSummaryStream(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { range: REPORT_RANGE_LAST_30_DAYS },
      'zh-CN',
      reply,
    );

    const errorEvent = events.find((e) => e.event === 'error')!;
    expect(errorEvent).toBeDefined();
    expect(errorEvent.data).toEqual({ message: 'LLM down' });
    expect(reply.raw.end).toHaveBeenCalled();
  });

  // ── previewClinicSummary ──────────────────────────────────────────────

  it('returns clinic summary preview envelope', async () => {
    const summary = {
      generatedAt: '2026-07-10T08:00:00.000Z',
      dataRange: 'last_30_days',
      profile: {
        nickname: '匿**',
        age: 30,
        sexAtBirth: 'male',
        bloodType: 'A',
      },
      allergies: [],
      conditions: [],
      currentMedicines: [],
      disclaimer: '此摘要仅供参考。',
    };
    clinicSummaryService.buildClinicSummary.mockResolvedValue(summary);

    const result = await controller.previewClinicSummary({
      sub: 'u1',
      email: 'a@b.c',
      status: 'active',
    });

    expect(clinicSummaryService.buildClinicSummary).toHaveBeenCalledWith('u1');
    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: summary,
    });
  });

  // ── shareClinicSummary ────────────────────────────────────────────────

  it('returns share link envelope', async () => {
    const shareResponse = {
      shareUrl:
        'http://localhost:3000/api/v1/reports/clinic-summary/shared/abc123',
      expiresAt: '2026-07-11T08:00:00.000Z',
    };
    clinicSummaryService.createShareLink.mockResolvedValue(shareResponse);

    const result = await controller.shareClinicSummary({
      sub: 'u1',
      email: 'a@b.c',
      status: 'active',
    });

    expect(clinicSummaryService.createShareLink).toHaveBeenCalledWith('u1');
    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: shareResponse,
    });
  });

  // ── getSharedClinicSummary ────────────────────────────────────────────

  it('returns shared clinic summary envelope when token is valid', async () => {
    const summary = {
      generatedAt: '2026-07-10T08:00:00.000Z',
      dataRange: 'last_30_days',
      profile: {
        nickname: '匿**',
        age: 30,
        sexAtBirth: 'male',
        bloodType: 'A',
      },
      allergies: [],
      conditions: [],
      currentMedicines: [],
      disclaimer: '此摘要仅供参考。',
    };
    clinicSummaryService.getSharedSummary.mockResolvedValue(summary);

    const result = await controller.getSharedClinicSummary('valid-token');

    expect(clinicSummaryService.getSharedSummary).toHaveBeenCalledWith(
      'valid-token',
    );
    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: summary,
    });
  });

  it('throws HttpException 410 when shared summary not found', async () => {
    clinicSummaryService.getSharedSummary.mockResolvedValue(null);

    await expect(
      controller.getSharedClinicSummary('expired-token'),
    ).rejects.toThrow(HttpException);

    try {
      await controller.getSharedClinicSummary('expired-token');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(HttpStatus.GONE);
    }
  });

  // ── downloadClinicSummaryPdf ──────────────────────────────────────────

  it('sends PDF buffer for authenticated user', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 mock');
    clinicSummaryService.exportPdf.mockResolvedValue(pdfBuffer);

    const reply = makeMockReply([]);

    await controller.downloadClinicSummaryPdf(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      'zh-CN',
      reply,
    );

    expect(clinicSummaryService.exportPdf).toHaveBeenCalledWith('u1', 'zh-CN');
    expect(reply.send).toHaveBeenCalledWith(pdfBuffer);
  });

  // ── downloadSharedClinicSummaryPdf ────────────────────────────────────

  it('sends PDF buffer for valid shared token', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 mock');
    clinicSummaryService.exportSharedPdf.mockResolvedValue(pdfBuffer);

    const reply = makeMockReply([]);

    await controller.downloadSharedClinicSummaryPdf(
      'valid-token',
      'zh-CN',
      reply,
    );

    expect(clinicSummaryService.exportSharedPdf).toHaveBeenCalledWith(
      'valid-token',
      'zh-CN',
    );
    expect(reply.send).toHaveBeenCalledWith(pdfBuffer);
  });

  it('throws HttpException 410 when shared PDF token is expired', async () => {
    clinicSummaryService.exportSharedPdf.mockResolvedValue(null);

    const reply = makeMockReply([]);

    await expect(
      controller.downloadSharedClinicSummaryPdf(
        'expired-token',
        'zh-CN',
        reply,
      ),
    ).rejects.toThrow(HttpException);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────

function makeMockReply(
  events: Array<{ event: string; data: unknown }>,
): FastifyReply {
  let buffer = '';
  const raw = {
    writeHead: vi.fn(),
    write: vi.fn((chunk: string) => {
      buffer += chunk;
      // SSE events are separated by \n\n
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const eventMatch = part.match(/event: (\w+)/);
        const dataMatch = part.match(/data: (.+)/);
        if (eventMatch && dataMatch) {
          events.push({
            event: eventMatch[1]!,
            data: JSON.parse(dataMatch[1]!),
          });
        }
      }
    }),
    end: vi.fn(),
  };
  const reply = {
    raw,
    send: vi.fn(),
  };
  return reply as unknown as FastifyReply;
}

function makeDashboard(
  overrides: Partial<ReportDashboardDataDto> = {},
): ReportDashboardDataDto {
  return {
    range: REPORT_RANGE_LAST_7_DAYS,
    startDate: '2026-06-06',
    endDate: '2026-06-12',
    generatedAt: '2026-06-12T00:00:00.000Z',
    score: {
      value: 78,
      maxValue: 100,
      status: 'stable',
      summary: '本周记录较完整。',
    },
    metrics: [],
    trends: [],
    findings: [],
    patterns: [],
    aiSummaryEnabled: false,
    ...overrides,
  };
}

function makeSummary(
  overrides: Partial<ReportSummaryDataDto> = {},
): ReportSummaryDataDto {
  return {
    range: REPORT_RANGE_LAST_30_DAYS,
    startDate: '2026-05-14',
    endDate: '2026-06-12',
    generatedAt: '2026-06-12T08:00:00.000Z',
    summary: '本月记录已更新。',
    bullets: [
      {
        kind: 'medication',
        text: '本月用药节奏整体稳定。',
      },
      {
        kind: 'hydration',
        text: '饮水仍有几天偏低。',
      },
    ],
    actionLabel: '查看报告',
    action: 'today',
    confidenceNote: '仅基于近 30 天已记录数据生成，不构成诊断或治疗建议。',
    ...overrides,
  };
}
