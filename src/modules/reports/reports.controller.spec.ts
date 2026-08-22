import { Test, type TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { I18nService } from 'nestjs-i18n';
import { HealthEventKind, HealthEventStatus } from '#generated/prisma/client';
import type { ClinicSummaryShareField } from '#generated/prisma/client';
import { SseConnectionRegistry } from '../../common';
import {
  REPORT_RANGE_CUSTOM,
  REPORT_RANGE_LAST_30_DAYS,
  REPORT_RANGE_LAST_7_DAYS,
} from './dto/report-dashboard-query.dto';

import type { ReportDashboardDataDto } from './dto/report-dashboard-response.dto';

import type { ReportSummaryDataDto } from './dto/report-summary-response.dto';
import type { EventReviewDataDto } from './dto/event-review-response.dto';
import type { ClinicSummaryDto } from './dto/clinic-summary-response.dto';
import { CLINIC_SUMMARY_SELECTABLE_FIELDS } from './dto/clinic-summary-request.dto';
import { ReportsAiSummaryService } from './services/ai-summary/summary.service';
import { ReportSummaryQueueService } from './services/ai-summary/summary-queue.service';
import {
  ClinicSummaryService,
  sharedSummaryCacheKey,
} from './services/clinic-summary/summary.service';
import { ClinicSummaryPdfQueueService } from './services/clinic-summary/pdf-queue.service';
import { ShareService } from './services/clinic-summary/share.service';
import { EventReviewService } from './services/event-review/review.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './dashboard/dashboard.service';

/** TTL mirror of ReportsController.SHARED_VIEW_TTL_MS (7 days). */
const SHARED_VIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** All six share-field enum values as the store layer types them. */
const ALL_SHARE_FIELDS = [
  ...CLINIC_SUMMARY_SELECTABLE_FIELDS,
] as ClinicSummaryShareField[];
describe('ReportsController', () => {
  let controller: ReportsController;
  let service: vi.Mocked<ReportsService>;
  let aiSummaryService: vi.Mocked<ReportsAiSummaryService>;
  let clinicSummaryService: vi.Mocked<ClinicSummaryService>;
  let shareService: vi.Mocked<ShareService>;
  let pdfQueueService: {
    isConfigured: boolean;
    enqueue: vi.Mock;
    getStatus: vi.Mock;
  };
  let cacheManager: { get: vi.Mock; set: vi.Mock };
  let eventReviewService: vi.Mocked<EventReviewService>;
  let sseRegistry: SseConnectionRegistry;

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
            getSharedSummary: vi.fn(),
            exportPdf: vi.fn(),
            exportSharedPdf: vi.fn(),
          },
        },
        {
          provide: ShareService,
          useValue: {
            createShare: vi.fn(),
            listSharesForUser: vi.fn(),
            revokeShare: vi.fn(),
          },
        },
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: vi.fn(),
            set: vi.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: vi
              .fn()
              .mockReturnValue({ publicBaseUrl: 'http://localhost:3000' }),
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
        {
          provide: EventReviewService,
          useValue: {
            buildCurrent: vi.fn(),
            list: vi.fn(),
            buildForEvent: vi.fn(),
          },
        },
        {
          provide: SseConnectionRegistry,
          useValue: {
            register: vi.fn(),
            unregister: vi.fn(),
            closeAll: vi.fn(),
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

    controller = module.get(ReportsController);
    service = module.get(ReportsService);
    aiSummaryService = module.get(ReportsAiSummaryService);
    clinicSummaryService = module.get(ClinicSummaryService);
    shareService = module.get(ShareService);
    pdfQueueService = module.get(ClinicSummaryPdfQueueService);
    cacheManager = module.get(CACHE_MANAGER);
    eventReviewService = module.get(EventReviewService);
    sseRegistry = module.get(SseConnectionRegistry);
  });

  // ── getDashboard ──────────────────────────────────────────────────────

  it('should return the report dashboard resource', async () => {
    const dashboard = makeDashboard();
    service.getDashboard.mockResolvedValue(dashboard);

    expect(
      await controller.getDashboard(
        { sub: 'u1', email: 'a@b.c', status: 'active' },
        { range: REPORT_RANGE_LAST_7_DAYS },
        'en',
      ),
    ).toEqual(dashboard);
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
    ).toEqual(dashboard);
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

  it('should return the report summary resource', async () => {
    const summary = makeSummary();
    aiSummaryService.generate.mockResolvedValue(summary);

    expect(
      await controller.generateSummary(
        { sub: 'u1', email: 'a@b.c', status: 'active' },
        { range: REPORT_RANGE_LAST_30_DAYS },
        'zh-CN',
      ),
    ).toEqual(summary);
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
    expect(sseRegistry.register).toHaveBeenCalledWith(reply.raw);
    expect(sseRegistry.unregister).toHaveBeenCalledWith(reply.raw);
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

  it('returns the clinic summary preview resource', async () => {
    const summary = makeClinicSummary();
    clinicSummaryService.buildClinicSummary.mockResolvedValue(summary);

    const result = await controller.previewClinicSummary(
      {
        sub: 'u1',
        email: 'a@b.c',
        status: 'active',
      },
      {},
      'zh-CN',
    );

    expect(clinicSummaryService.buildClinicSummary).toHaveBeenCalledWith(
      'u1',
      'zh-CN',
      {},
    );
    expect(result).toEqual(summary);
  });

  it('forwards the request scope and field selection to the summary service', async () => {
    clinicSummaryService.buildClinicSummary.mockResolvedValue(
      makeClinicSummary(),
    );

    await controller.previewClinicSummary(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      {
        eventId: 'evt-1',
        dateFrom: '2026-08-01',
        dateTo: '2026-08-10',
        selectedFields: ['profile', 'sleep'],
      },
      'zh-CN',
    );

    expect(clinicSummaryService.buildClinicSummary).toHaveBeenCalledWith(
      'u1',
      'zh-CN',
      {
        eventId: 'evt-1',
        dateFrom: '2026-08-01',
        dateTo: '2026-08-10',
        selectedFields: ['profile', 'sleep'],
      },
    );
  });

  // ── shareClinicSummary ────────────────────────────────────────────────

  it('creates a share record and returns the share URL built from the configured base URL', async () => {
    const summary = makeClinicSummary();
    clinicSummaryService.buildClinicSummary.mockResolvedValue(summary);
    shareService.createShare.mockResolvedValue({
      shareId: 'share-1',
      token: 'tok123',
      expiresAt: new Date('2026-07-18T08:00:00.000Z'),
      scope: { eventId: 'evt-1', dateFrom: null, dateTo: null },
      selectedFields: ['event_overview'],
    });

    const result = await controller.shareClinicSummary(
      {
        sub: 'u1',
        email: 'a@b.c',
        status: 'active',
      },
      { eventId: 'evt-1', selectedFields: ['event_overview'] },
      'zh-CN',
    );

    expect(clinicSummaryService.buildClinicSummary).toHaveBeenCalledWith(
      'u1',
      'zh-CN',
      { eventId: 'evt-1', selectedFields: ['event_overview'] },
    );
    expect(shareService.createShare).toHaveBeenCalledWith('u1', {
      eventId: 'evt-1',
      dateFrom: null,
      dateTo: null,
      selectedFields: ['event_overview'],
    });
    // The cached shared payload is keyed by the share token hash (single
    // key derivation shared with the service) so the public read gate
    // (getSharedSummary) can serve exactly this view.
    expect(cacheManager.set).toHaveBeenCalledWith(
      sharedSummaryCacheKey('tok123'),
      summary,
      SHARED_VIEW_TTL_MS,
    );
    expect(result).toEqual({
      shareId: 'share-1',
      token: 'tok123',
      shareUrl:
        'http://localhost:3000/api/v1/user/reports/clinic-summary/shared/tok123',
      expiresAt: '2026-07-18T08:00:00.000Z',
      scope: { eventId: 'evt-1', dateFrom: null, dateTo: null },
      selectedFields: ['event_overview'],
    });
  });

  it('forwards only the winning event scope to the share store when dates are also supplied', async () => {
    clinicSummaryService.buildClinicSummary.mockResolvedValue(
      makeClinicSummary(),
    );
    shareService.createShare.mockResolvedValue({
      shareId: 'share-1',
      token: 'tok123',
      expiresAt: new Date('2026-07-18T08:00:00.000Z'),
      scope: { eventId: 'evt-1', dateFrom: null, dateTo: null },
      selectedFields: ['event_overview'],
    });

    await controller.shareClinicSummary(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      {
        eventId: 'evt-1',
        dateFrom: '2026-08-01',
        dateTo: '2026-08-10',
      },
      'zh-CN',
    );

    // Event scope wins: the strict-XOR share record layer sees only the
    // event, never the date pair.
    expect(shareService.createShare).toHaveBeenCalledWith('u1', {
      eventId: 'evt-1',
      dateFrom: null,
      dateTo: null,
      selectedFields: [...CLINIC_SUMMARY_SELECTABLE_FIELDS],
    });
  });

  it('defaults selectedFields to every share field when omitted', async () => {
    clinicSummaryService.buildClinicSummary.mockResolvedValue(
      makeClinicSummary(),
    );
    shareService.createShare.mockResolvedValue({
      shareId: 'share-1',
      token: 'tok123',
      expiresAt: new Date('2026-07-18T08:00:00.000Z'),
      scope: {
        eventId: null,
        dateFrom: new Date('2026-08-01'),
        dateTo: new Date('2026-08-07'),
      },
      selectedFields: ALL_SHARE_FIELDS,
    });

    const result = await controller.shareClinicSummary(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { dateFrom: '2026-08-01', dateTo: '2026-08-07' },
      'zh-CN',
    );

    expect(shareService.createShare).toHaveBeenCalledWith('u1', {
      eventId: null,
      dateFrom: '2026-08-01',
      dateTo: '2026-08-07',
      selectedFields: [...CLINIC_SUMMARY_SELECTABLE_FIELDS],
    });
    expect(result).toEqual({
      shareId: 'share-1',
      token: 'tok123',
      shareUrl:
        'http://localhost:3000/api/v1/user/reports/clinic-summary/shared/tok123',
      expiresAt: '2026-07-18T08:00:00.000Z',
      scope: {
        eventId: null,
        dateFrom: '2026-08-01T00:00:00.000Z',
        dateTo: '2026-08-07T00:00:00.000Z',
      },
      selectedFields: [...CLINIC_SUMMARY_SELECTABLE_FIELDS],
    });
  });

  it('materializes the default last_30_days range when no scope is supplied', async () => {
    clinicSummaryService.buildClinicSummary.mockResolvedValue(
      makeClinicSummary(),
    );
    shareService.createShare.mockResolvedValue({
      shareId: 'share-1',
      token: 'tok123',
      expiresAt: new Date('2026-07-18T08:00:00.000Z'),
      scope: {
        eventId: null,
        dateFrom: new Date(),
        dateTo: new Date(),
      },
      selectedFields: ALL_SHARE_FIELDS,
    });

    await controller.shareClinicSummary(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      {},
      'zh-CN',
    );

    // The strict-XOR share record always receives an explicit scope; the
    // default range mirrors the service's last_30_days window (30 inclusive
    // calendar days ending today, UTC).
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const expectedDateTo = today.toISOString().slice(0, 10);
    const expectedDateFrom = new Date(
      today.getTime() - 29 * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);
    expect(shareService.createShare).toHaveBeenCalledWith('u1', {
      eventId: null,
      dateFrom: expectedDateFrom,
      dateTo: expectedDateTo,
      selectedFields: [...CLINIC_SUMMARY_SELECTABLE_FIELDS],
    });
  });

  it('revokes the share best-effort and rethrows when the cache write fails', async () => {
    clinicSummaryService.buildClinicSummary.mockResolvedValue(
      makeClinicSummary(),
    );
    shareService.createShare.mockResolvedValue({
      shareId: 'share-1',
      token: 'tok123',
      expiresAt: new Date('2026-07-18T08:00:00.000Z'),
      scope: { eventId: 'evt-1', dateFrom: null, dateTo: null },
      selectedFields: ['event_overview'],
    });
    shareService.revokeShare.mockResolvedValue(true);
    cacheManager.set.mockRejectedValue(new Error('cache down'));

    await expect(
      controller.shareClinicSummary(
        { sub: 'u1', email: 'a@b.c', status: 'active' },
        { eventId: 'evt-1' },
        'zh-CN',
      ),
    ).rejects.toThrow('cache down');

    // The persisted grant is rolled back so no orphaned share can outlive a
    // view the public gate can never serve.
    expect(shareService.revokeShare).toHaveBeenCalledWith('u1', 'share-1');
  });

  // ── listClinicSummaryShares ────────────────────────────────────────────

  it('lists the current user shares as a resource without token fields', async () => {
    shareService.listSharesForUser.mockResolvedValue([
      {
        id: 'share-1',
        createdAt: new Date('2026-08-14T08:00:00.000Z'),
        expiresAt: new Date('2026-08-21T08:00:00.000Z'),
        revokedAt: null,
        accessCount: 2,
        firstAccessedAt: new Date('2026-08-15T08:00:00.000Z'),
        lastAccessedAt: new Date('2026-08-16T08:00:00.000Z'),
        scope: { eventId: 'evt-1', dateFrom: null, dateTo: null },
        selectedFields: ['event_overview'],
      },
    ]);

    const result = await controller.listClinicSummaryShares({
      sub: 'u1',
      email: 'a@b.c',
      status: 'active',
    });

    expect(shareService.listSharesForUser).toHaveBeenCalledWith('u1');
    expect(result).toEqual({
      items: [
        {
          id: 'share-1',
          createdAt: new Date('2026-08-14T08:00:00.000Z'),
          expiresAt: new Date('2026-08-21T08:00:00.000Z'),
          revokedAt: null,
          accessCount: 2,
          firstAccessedAt: new Date('2026-08-15T08:00:00.000Z'),
          lastAccessedAt: new Date('2026-08-16T08:00:00.000Z'),
          scope: { eventId: 'evt-1', dateFrom: null, dateTo: null },
          selectedFields: ['event_overview'],
        },
      ],
    });
    // The list payload mirrors the service read model: no token ever surfaces.
    expect(result.items[0]).not.toHaveProperty('tokenHash');
    expect(result.items[0]).not.toHaveProperty('token');
  });

  it('scopes the list query to the caller so foreign shares never leak', async () => {
    shareService.listSharesForUser.mockResolvedValue([]);

    await controller.listClinicSummaryShares({
      sub: 'u1',
      email: 'a@b.c',
      status: 'active',
    });
    await controller.listClinicSummaryShares({
      sub: 'u2',
      email: 'b@c.d',
      status: 'active',
    });

    expect(shareService.listSharesForUser).toHaveBeenNthCalledWith(1, 'u1');
    expect(shareService.listSharesForUser).toHaveBeenNthCalledWith(2, 'u2');
  });

  // ── getSharedClinicSummary ────────────────────────────────────────────

  it('returns shared clinic summary resource when token is valid', async () => {
    const summary = makeClinicSummary();
    clinicSummaryService.getSharedSummary.mockResolvedValue(summary);

    const result = await controller.getSharedClinicSummary(
      'valid-token',
      'zh-CN',
    );

    expect(clinicSummaryService.getSharedSummary).toHaveBeenCalledWith(
      'valid-token',
    );
    expect(result).toEqual(summary);
  });

  it('throws HttpException 404 when the shared summary token is expired or revoked', async () => {
    clinicSummaryService.getSharedSummary.mockResolvedValue(null);

    await expect(
      controller.getSharedClinicSummary('expired-token', 'zh-CN'),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
  });

  // ── downloadClinicSummaryPdf ──────────────────────────────────────────

  it('sends PDF buffer for authenticated user', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 mock');
    clinicSummaryService.exportPdf.mockResolvedValue(pdfBuffer);

    const reply = makeMockReply([]);

    await controller.downloadClinicSummaryPdf(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { eventId: 'evt-1', selectedFields: ['profile'] },
      'zh-CN',
      reply,
    );

    expect(clinicSummaryService.exportPdf).toHaveBeenCalledWith('u1', 'zh-CN', {
      eventId: 'evt-1',
      selectedFields: ['profile'],
    });
    expect(reply.send).toHaveBeenCalledWith(pdfBuffer);
  });

  // ── exportClinicSummaryPdfAsync ───────────────────────────────────────

  it('exports a scoped request synchronously so the queue never drops the scope', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 mock');
    clinicSummaryService.exportPdf.mockResolvedValue(pdfBuffer);

    const result = await controller.exportClinicSummaryPdfAsync(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { eventId: 'evt-1' },
      'zh-CN',
    );

    expect(clinicSummaryService.exportPdf).toHaveBeenCalledWith('u1', 'zh-CN', {
      eventId: 'evt-1',
    });
    expect(result).toEqual({ pdfBase64: pdfBuffer.toString('base64') });
  });

  it('routes an unscoped export through the async queue path', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 mock');
    clinicSummaryService.exportPdf.mockResolvedValue(pdfBuffer);

    const result = await controller.exportClinicSummaryPdfAsync(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      {},
      'zh-CN',
    );

    // isConfigured is false in this harness → the queue is skipped and the
    // default-scope fallback produces the PDF; the request must NOT take the
    // scoped sync branch (no options forwarded).
    expect(pdfQueueService.enqueue).not.toHaveBeenCalled();
    expect(clinicSummaryService.exportPdf).toHaveBeenCalledWith('u1', 'zh-CN');
    expect(result).toEqual({ pdfBase64: pdfBuffer.toString('base64') });
  });

  // ── revokeClinicSummaryShare ──────────────────────────────────────────

  it('revokes a share owned by the current user', async () => {
    shareService.revokeShare.mockResolvedValue(true);

    await expect(
      controller.revokeClinicSummaryShare(
        { sub: 'u1', email: 'a@b.c', status: 'active' },
        'share-1',
        'zh-CN',
      ),
    ).resolves.toBeUndefined();

    expect(shareService.revokeShare).toHaveBeenCalledWith('u1', 'share-1');
  });

  it('throws HttpException 404 when the share is not found or not owned', async () => {
    shareService.revokeShare.mockResolvedValue(false);

    await expect(
      controller.revokeClinicSummaryShare(
        { sub: 'u1', email: 'a@b.c', status: 'active' },
        'foreign-share',
        'zh-CN',
      ),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
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

  it('throws HttpException 404 when the shared PDF token is expired or revoked', async () => {
    clinicSummaryService.exportSharedPdf.mockResolvedValue(null);

    const reply = makeMockReply([]);

    await expect(
      controller.downloadSharedClinicSummaryPdf(
        'expired-token',
        'zh-CN',
        reply,
      ),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
  });

  // ── getCurrentReview ──────────────────────────────────────────────

  it('returns the current event review resource', async () => {
    const review = makeReview();
    eventReviewService.buildCurrent.mockResolvedValue(review);

    expect(
      await controller.getCurrentReview({
        sub: 'u1',
        email: 'a@b.c',
        status: 'active',
      }),
    ).toEqual(review);
    expect(eventReviewService.buildCurrent).toHaveBeenCalledWith('u1');
  });

  it('returns null when no event review exists', async () => {
    eventReviewService.buildCurrent.mockResolvedValue(null);

    expect(
      await controller.getCurrentReview({
        sub: 'u1',
        email: 'a@b.c',
        status: 'active',
      }),
    ).toBeNull();
  });

  // ── listReviews ───────────────────────────────────────────────────

  it('returns the review list resource and forwards status and cursor', async () => {
    const listData = {
      items: [makeReview().event],
      total: 1,
      nextCursor: null,
    };
    eventReviewService.list.mockResolvedValue(listData);
    const query = {
      status: HealthEventStatus.ended,
      cursor: '2026-08-05T08:00:00.000Z|evt-1',
      limit: 20,
    };

    expect(
      await controller.listReviews(
        { sub: 'u1', email: 'a@b.c', status: 'active' },
        query,
      ),
    ).toEqual(listData);
    expect(eventReviewService.list).toHaveBeenCalledWith('u1', query);
  });

  // ── getEventReview ────────────────────────────────────────────────

  it('returns the event review resource for the event id', async () => {
    const review = makeReview();
    eventReviewService.buildForEvent.mockResolvedValue(review);

    expect(
      await controller.getEventReview(
        { sub: 'u1', email: 'a@b.c', status: 'active' },
        'evt-1',
      ),
    ).toEqual(review);
    expect(eventReviewService.buildForEvent).toHaveBeenCalledWith(
      'u1',
      'evt-1',
    );
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────

function makeClinicSummary(): ClinicSummaryDto {
  return {
    generatedAt: '2026-07-10T08:00:00.000Z',
    dataRange: 'last_30_days',
    scopeLabel: 'last_30_days',
    start: '2026-06-11T00:00:00.000Z',
    end: '2026-07-10T08:00:00.000Z',
    selectedFields: ['profile', 'allergies', 'conditions', 'currentMedicines'],
    coverage: {
      checkIns: {
        state: 'unknown',
        coverage: 'none',
        sources: [],
        observedCount: 0,
        expectedCount: null,
        windowStart: null,
        windowEnd: null,
      },
      water: {
        state: 'unknown',
        coverage: 'none',
        sources: [],
        observedCount: 0,
        expectedCount: null,
        windowStart: null,
        windowEnd: null,
      },
      dose: {
        state: 'unknown',
        coverage: 'none',
        sources: [],
        observedCount: 0,
        expectedCount: null,
        windowStart: null,
        windowEnd: null,
      },
      sleep: {
        state: 'unknown',
        coverage: 'none',
        sources: [],
        observedCount: 0,
        expectedCount: null,
        windowStart: null,
        windowEnd: null,
      },
    },
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
}

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
    coverage: {
      medication: { trackedDays: 25, totalDays: 30 },
      water: { trackedDays: 20, totalDays: 30 },
      sleep: { trackedDays: 0, totalDays: 30 },
    },
    observedPattern: {
      kind: 'medication',
      text: '本月用药节奏整体稳定。',
      source: 'reminder_plan',
    },
    lowRiskAction: {
      label: '查看报告',
      text: '继续记录日常饮水量。',
    },
    disclaimer: '仅基于近 30 天已记录数据，不构成诊断或治疗建议。',
    ...overrides,
  };
}

function makeReview(
  overrides: Partial<EventReviewDataDto> = {},
): EventReviewDataDto {
  return {
    event: {
      id: 'evt-1',
      kind: HealthEventKind.symptom,
      title: '头痛观察',
      status: HealthEventStatus.active,
      startedAt: '2026-08-01T08:00:00.000Z',
      endedAt: null,
      outcome: null,
      currentMedicineIds: ['med-1'],
    },
    sections: {
      whatHappened: {
        state: 'available',
        facts: {
          code: 'health_event',
          arguments: {
            kind: HealthEventKind.symptom,
            title: '头痛观察',
            startedAt: '2026-08-01T08:00:00.000Z',
            endedAt: null,
            medicineIds: ['med-1'],
            symptomRecordCount: 1,
            checkInCount: 2,
          },
        },
      },
      keyChanges: { state: 'unknown', reasonCode: 'no_observations' },
      completedActions: {
        state: 'unknown',
        reasonCode: 'no_completed_actions',
      },
      nextStep: {
        state: 'available',
        facts: {
          code: 'active_check_in',
          arguments: { hasTodayCheckIn: false },
        },
      },
    },
    coverage: {
      checkIns: {
        state: 'observed',
        coverage: 'partial',
        sources: ['manual'],
        observedCount: 2,
        expectedCount: null,
        firstCheckInDate: '2026-08-10',
        lastCheckInDate: '2026-08-11',
        todayCheckIn: null,
        windowStart: '2026-08-01T08:00:00.000Z',
        windowEnd: '2026-08-13T12:00:00.000Z',
      },
      dailyRecords: {
        state: 'unknown',
        coverage: 'none',
        sources: [],
        observedCount: 0,
        expectedCount: null,
        windowStart: '2026-08-01T08:00:00.000Z',
        windowEnd: '2026-08-13T12:00:00.000Z',
      },
      doseLogs: {
        state: 'unknown',
        coverage: 'none',
        sources: [],
        observedCount: 0,
        expectedCount: null,
        windowStart: '2026-08-01T08:00:00.000Z',
        windowEnd: '2026-08-13T12:00:00.000Z',
      },
    },
    sourceTimestamps: {
      checkIns: '2026-08-11',
      dailyRecords: null,
      doseLogs: null,
    },
    availableActions: ['check_in', 'end_event'],
    generatedAt: '2026-08-13T12:00:00.000Z',
    ...overrides,
  };
}
