import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  Res,
  SerializeOptions,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { I18nLang, I18nService } from 'nestjs-i18n';

import { ConfigKey } from '../../config/env/config-keys.enum.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';

import {
  endSse,
  prepareSse,
  SseProblemDetailsMapper,
  writeSseEvent,
  SseConnectionRegistry,
} from '../../common/index.js';
import { extractErrorInfo, enqueueOrFallback } from '../../common/index.js';
import type { UserPayload } from '../auth/index.js';
import { CurrentUser } from '../auth/index.js';

import { Public } from '../auth/index.js';
import { generateReportSummarySchema } from './dto/generate-report-summary.dto.js';
import type { GenerateReportSummaryDto } from './dto/generate-report-summary.dto.js';

import { reportDashboardQuerySchema } from './dto/report-dashboard-query.dto.js';
import type { ReportDashboardQueryDto } from './dto/report-dashboard-query.dto.js';

import { reportDashboardResponseSchema } from './dto/report-dashboard-response.dto.js';

import {
  reportSummaryAsyncResponseSchema,
  reportSummaryResponseSchema,
} from './dto/report-summary-response.dto.js';

import {
  clinicSummaryExportAsyncResponseSchema,
  clinicSummaryResponseSchema,
  clinicSummaryShareResponseSchema,
} from './dto/clinic-summary-response.dto.js';
import { clinicSummaryShareListResponseSchema } from './dto/clinic-summary-share-list.dto.js';
import {
  clinicSummaryRequestSchema,
  CLINIC_SUMMARY_SELECTABLE_FIELDS,
} from './dto/clinic-summary-request.dto.js';
import type { ClinicSummaryRequestDto } from './dto/clinic-summary-request.dto.js';
import { eventReviewListQuerySchema } from './dto/event-review-list-query.dto.js';
import type { EventReviewListQueryDto } from './dto/event-review-list-query.dto.js';
import {
  eventReviewDataSchema,
  eventReviewListResponseSchema,
  eventReviewNullableResponseSchema,
  eventReviewResponseSchema,
} from './dto/event-review-response.dto.js';
import { ReportSummaryQueueService } from './services/ai-summary/summary-queue.service.js';

import { ReportsAiSummaryService } from './services/ai-summary/summary.service.js';
import { ClinicSummaryPdfQueueService } from './services/clinic-summary/pdf-queue.service.js';

import {
  ClinicSummaryService,
  sharedSummaryCacheKey,
} from './services/clinic-summary/summary.service.js';
import type { ClinicSummaryOptions } from './services/clinic-summary/summary.service.js';
import { ShareService } from './services/clinic-summary/share.service.js';
import { EventReviewService } from './services/event-review/review.service.js';
import { ReportsService } from './dashboard/dashboard.service.js';

/** Milliseconds per day — used to materialize the default share range. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

@ApiTags('Reports')
@ApiBearerAuth('access-token')
@Controller('reports')
export class ReportsController {
  private readonly logger = new Logger(ReportsController.name);

  constructor(
    private readonly reportsService: ReportsService,
    private readonly reportsAiSummaryService: ReportsAiSummaryService,
    private readonly reportSummaryQueueService: ReportSummaryQueueService,
    private readonly clinicSummaryService: ClinicSummaryService,
    private readonly clinicSummaryPdfQueueService: ClinicSummaryPdfQueueService,
    private readonly shareService: ShareService,
    private readonly eventReviewService: EventReviewService,
    private readonly sseRegistry: SseConnectionRegistry,
    private readonly sseProblemDetails: SseProblemDetailsMapper,
    private readonly i18n: I18nService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
  ) {}

  /**
   * TTL of the shared summary view cached under the share token at create
   * time. Mirrors `ShareService.DEFAULT_SHARE_TTL_DAYS` (7 days) so the
   * cached copy never outlives the persisted grant and the grant never
   * outlives the copy — `ClinicSummaryService.getSharedSummary` (the single
   * public-read gate) still re-checks revokedAt/expiresAt before serving.
   */
  private static readonly SHARED_VIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * Summary-service options mirroring the request DTO. Event scope wins (the
   * service resolves eventId first and ignores the date pair), so both are
   * forwarded verbatim; an empty scope is forwarded as-is and the service
   * falls back to the default last_30_days range.
   */
  private toSummaryOptions(dto: ClinicSummaryRequestDto): ClinicSummaryOptions {
    const options: ClinicSummaryOptions = {};
    if (dto.eventId != null) {
      options.eventId = dto.eventId;
    }
    if (dto.dateFrom != null) {
      options.dateFrom = dto.dateFrom;
    }
    if (dto.dateTo != null) {
      options.dateTo = dto.dateTo;
    }
    if (dto.selectedFields != null) {
      options.selectedFields = dto.selectedFields;
    }
    return options;
  }

  /**
   * Winning scope for the strict-XOR share record layer. Event scope wins;
   * a supplied date pair passes through; when neither is given the legacy
   * default range (last 30 inclusive calendar days ending today, UTC) is
   * materialized so the persisted record always carries an explicit scope —
   * matching the default view `ClinicSummaryService` builds for an unscoped
   * request.
   */
  private toShareScope(dto: ClinicSummaryRequestDto): {
    eventId: string | null;
    dateFrom: string | null;
    dateTo: string | null;
  } {
    if (dto.eventId != null) {
      return { eventId: dto.eventId, dateFrom: null, dateTo: null };
    }
    if (dto.dateFrom != null && dto.dateTo != null) {
      return { eventId: null, dateFrom: dto.dateFrom, dateTo: dto.dateTo };
    }
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return {
      eventId: null,
      dateFrom: new Date(today.getTime() - 29 * MS_PER_DAY)
        .toISOString()
        .slice(0, 10),
      dateTo: today.toISOString().slice(0, 10),
    };
  }

  /**
   * Public share URL. Base URL comes from the existing app configuration
   * (`PUBLIC_BASE_URL`, falling back to localhost) — never hardcoded here.
   * The token travels as a path parameter only, never in a query string.
   */
  private buildShareUrl(token: string): string {
    const appConfig = this.configService.get<{ publicBaseUrl: string }>(
      ConfigKey.App,
    );
    const baseUrl = appConfig?.publicBaseUrl ?? 'http://localhost:3000';
    return `${baseUrl}/api/v1/user/reports/clinic-summary/shared/${token}`;
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get authenticated user report dashboard' })
  @ApiResponse({
    status: 200,
    description: 'Report dashboard with metric/trend/finding/pattern blocks.',
  })
  @SerializeOptions({ schema: reportDashboardResponseSchema })
  async getDashboard(
    @CurrentUser() user: UserPayload,
    @Query({ schema: reportDashboardQuerySchema })
    query: ReportDashboardQueryDto,
    @I18nLang() language: string,
  ) {
    return await this.reportsService.getDashboard(user.sub, query, language);
  }

  @Post('summary/generate')
  @ApiOperation({
    summary: 'Generate authenticated user AI summary for report',
  })
  @ApiResponse({
    status: 200,
    description: 'AI report summary resource.',
  })
  @SerializeOptions({ schema: reportSummaryResponseSchema })
  async generateSummary(
    @CurrentUser() user: UserPayload,
    @Body({ schema: generateReportSummarySchema })
    dto: GenerateReportSummaryDto,
    @I18nLang() language: string,
  ) {
    return await this.reportsAiSummaryService.generate(user.sub, dto, language);
  }

  @Post('summary/generate/async')
  @ApiOperation({
    summary: 'Enqueue async AI summary generation for report',
  })
  @ApiResponse({
    status: 202,
    description:
      'Returns either a queued jobId or the synchronous summary resource when the queue is unavailable.',
  })
  @SerializeOptions({ schema: reportSummaryAsyncResponseSchema })
  async generateSummaryAsync(
    @CurrentUser() user: UserPayload,
    @Body({ schema: generateReportSummarySchema })
    dto: GenerateReportSummaryDto,
    @I18nLang() language: string,
  ) {
    return await enqueueOrFallback(
      this.reportSummaryQueueService.isConfigured,
      'report-summary',
      () => this.reportSummaryQueueService.enqueue(user.sub, dto, language),
      () => this.reportsAiSummaryService.generate(user.sub, dto, language),
      'result',
      this.logger,
    );
  }

  @SkipThrottle()
  @Get('summary/generate/status/:jobId')
  @ApiOperation({
    summary: 'Poll async report AI summary generation status',
  })
  @ApiResponse({
    status: 200,
    description: 'Job status (pending, completed, or failed)',
  })
  async generateSummaryStatus(
    @CurrentUser() user: UserPayload,
    @Param('jobId') jobId: string,
  ) {
    const status = await this.reportSummaryQueueService.getStatus(
      jobId,
      user.sub,
    );
    if (status == null) {
      return { status: 'not_found' };
    }
    return status;
  }

  @SkipThrottle()
  @Post('summary/generate/stream')
  @ApiOperation({
    summary: 'Stream authenticated user AI summary generation for report',
  })
  @ApiResponse({
    status: 200,
    description:
      'Server-Sent Events stream. Each event has an "event" field (chunk | result | error | done) and a JSON "data" field.',
    content: {
      'text/event-stream': {
        schema: { type: 'string' },
      },
    },
  })
  async generateSummaryStream(
    @CurrentUser() user: UserPayload,
    @Body({ schema: generateReportSummarySchema })
    dto: GenerateReportSummaryDto,
    @I18nLang() language: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    prepareSse(reply.raw, this.sseRegistry, language);

    try {
      const result = await this.reportsAiSummaryService.generateStream(
        user.sub,
        dto,
        language,
        ({ summary }) => {
          writeSseEvent(reply.raw, {
            event: 'summary',
            data: { summary },
          });
        },
      );

      writeSseEvent(reply.raw, {
        event: 'result',
        data: result,
      });
      writeSseEvent(reply.raw, {
        event: 'done',
        data: {},
      });
    } catch (error) {
      const { message: reason, stack } = extractErrorInfo(error);
      this.logger.error(
        `Report summary stream failed for user ${user.sub}: ${reason}`,
        stack,
      );
      writeSseEvent(reply.raw, {
        event: 'error',
        data: this.sseProblemDetails.build(error, { lang: language }),
      });
    } finally {
      endSse(reply.raw, this.sseRegistry);
    }
  }

  @Post('clinic-summary/preview')
  @ApiOperation({
    summary:
      'Generate a de-identified clinic summary for sharing with a doctor',
  })
  @ApiResponse({
    status: 201,
    description: 'The de-identified clinic summary preview.',
  })
  @SerializeOptions({ schema: clinicSummaryResponseSchema })
  async previewClinicSummary(
    @CurrentUser() user: UserPayload,
    @Body({ schema: clinicSummaryRequestSchema })
    dto: ClinicSummaryRequestDto,
    @I18nLang() language: string,
  ) {
    return await this.clinicSummaryService.buildClinicSummary(
      user.sub,
      language,
      this.toSummaryOptions(dto),
    );
  }

  @Post('clinic-summary/share')
  @ApiOperation({
    summary:
      'Create a revocable share link for the clinic summary (7-day expiry)',
  })
  @ApiResponse({
    status: 201,
    description: 'The created share record with its one-time token.',
  })
  @SerializeOptions({ schema: clinicSummaryShareResponseSchema })
  async shareClinicSummary(
    @CurrentUser() user: UserPayload,
    @Body({ schema: clinicSummaryRequestSchema })
    dto: ClinicSummaryRequestDto,
    @I18nLang() language: string,
  ) {
    const options = this.toSummaryOptions(dto);
    // Single filtered view: preview, PDF and the shared payload all consume
    // the same summary built here, so the cached share cannot drift from what
    // the owner previews (field-drift lock, Task 3).
    const summary = await this.clinicSummaryService.buildClinicSummary(
      user.sub,
      language,
      options,
    );
    // Only the winning scope reaches the strict-XOR share record layer (an
    // empty scope is materialized as the default range); the omitted
    // selection defaults to every share field.
    const share = await this.shareService.createShare(user.sub, {
      ...this.toShareScope(dto),
      selectedFields: dto.selectedFields ?? [
        ...CLINIC_SUMMARY_SELECTABLE_FIELDS,
      ],
    });
    // Link the persisted grant to its view: the public read gate
    // (ClinicSummaryService.getSharedSummary) serves this cached copy keyed
    // by the share token hash, and the persisted record gates/revokes it.
    // Persist-then-cache order is security-correct; if the cache write fails
    // the grant is rolled back best-effort so no orphaned share record can
    // outlive a view the gate can never serve.
    try {
      await this.cacheManager.set(
        sharedSummaryCacheKey(share.token),
        summary,
        ReportsController.SHARED_VIEW_TTL_MS,
      );
    } catch (error) {
      await this.shareService
        .revokeShare(user.sub, share.shareId)
        .catch((rollbackError: unknown) => {
          this.logger.error(
            `Failed to revoke orphaned share ${share.shareId} after cache write failure: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
            rollbackError instanceof Error ? rollbackError.stack : undefined,
          );
        });
      throw error;
    }
    return {
      shareId: share.shareId,
      token: share.token,
      shareUrl: this.buildShareUrl(share.token),
      expiresAt: share.expiresAt.toISOString(),
      scope: {
        eventId: share.scope.eventId,
        dateFrom: share.scope.dateFrom?.toISOString() ?? null,
        dateTo: share.scope.dateTo?.toISOString() ?? null,
      },
      selectedFields: share.selectedFields,
    };
  }

  @Get('clinic-summary/shares')
  @ApiOperation({
    summary: 'List the clinic summary shares of the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'The caller clinic-summary shares, newest first.',
  })
  @SerializeOptions({ schema: clinicSummaryShareListResponseSchema })
  async listClinicSummaryShares(@CurrentUser() user: UserPayload) {
    const items = await this.shareService.listSharesForUser(user.sub);
    // Normalize read-model timestamps (may be `Date` or already an ISO
    // string) before the response serializer validates the string contract.
    const toIso = (value: Date | string | null): string | null =>
      value == null
        ? null
        : value instanceof Date
          ? value.toISOString()
          : value;
    return {
      items: items.map((item) => ({
        id: item.id,
        createdAt: toIso(item.createdAt) ?? '',
        expiresAt: toIso(item.expiresAt) ?? '',
        revokedAt: toIso(item.revokedAt),
        accessCount: item.accessCount,
        firstAccessedAt: toIso(item.firstAccessedAt),
        lastAccessedAt: toIso(item.lastAccessedAt),
        scope: {
          eventId: item.scope.eventId,
          dateFrom: toIso(item.scope.dateFrom),
          dateTo: toIso(item.scope.dateTo),
        },
        selectedFields: item.selectedFields,
      })),
    };
  }

  @Public()
  @Get('clinic-summary/shared/:token')
  @ApiOperation({
    summary: 'Access a shared clinic summary by token (no auth required)',
    // Class-level @ApiBearerAuth would mark every operation as secured;
    // explicit empty security keeps this public route unauthenticated in the
    // generated spec (the runtime guard already opts out via @Public()).
    security: [],
  })
  @ApiResponse({
    status: 200,
    description: 'The shared clinic summary.',
  })
  @SerializeOptions({ schema: clinicSummaryResponseSchema })
  async getSharedClinicSummary(
    @Param('token') token: string,
    @I18nLang() language: string,
  ) {
    const summary = await this.clinicSummaryService.getSharedSummary(token);
    if (!summary) {
      throw new HttpException(
        {
          code: 'REPORT_SHARE_NOT_FOUND',
          message: this.i18n.t('reports-clinic-summary.share_link_expired', {
            lang: language,
          }),
        },
        HttpStatus.NOT_FOUND,
      );
    }
    return summary;
  }

  @Delete('clinic-summary/shares/:shareId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke a clinic summary share (current user owns the share)',
  })
  @ApiParam({ name: 'shareId' })
  @ApiResponse({
    status: 204,
    description: 'Share revoked; the shared URL now returns 404.',
  })
  async revokeClinicSummaryShare(
    @CurrentUser() user: UserPayload,
    @Param('shareId') shareId: string,
    @I18nLang() language: string,
  ) {
    const revoked = await this.shareService.revokeShare(user.sub, shareId);
    if (!revoked) {
      throw new HttpException(
        {
          code: 'REPORT_SHARE_NOT_FOUND',
          message: this.i18n.t('reports-clinic-summary.share_not_found', {
            lang: language,
          }),
        },
        HttpStatus.NOT_FOUND,
      );
    }
    return;
  }

  @Post('clinic-summary/export/async')
  @ApiOperation({
    summary: 'Enqueue async clinic summary PDF export',
  })
  @ApiResponse({
    status: 201,
    description:
      'Unscoped requests use the async queue job (jobId for polling); an ' +
      'explicit scope is exported synchronously with the requested scope ' +
      'honored (pdfBase64) because the queue job only carries the default ' +
      'scope. When no queue is configured, both paths return the base64 PDF ' +
      'synchronously.',
  })
  @SerializeOptions({ schema: clinicSummaryExportAsyncResponseSchema })
  async exportClinicSummaryPdfAsync(
    @CurrentUser() user: UserPayload,
    @Body({ schema: clinicSummaryRequestSchema })
    dto: ClinicSummaryRequestDto,
    @I18nLang() language: string,
  ) {
    const options = this.toSummaryOptions(dto);
    // The queue job carries only userId + locale (PdfExportJobData), so an
    // explicit scope is exported synchronously with the requested scope
    // honored — the async path never silently drops event/date/field
    // selection. Unscoped (default-scope) requests keep the async job.
    const hasCustomScope =
      dto.eventId != null ||
      dto.dateFrom != null ||
      dto.dateTo != null ||
      dto.selectedFields != null;
    if (hasCustomScope) {
      return {
        pdfBase64: (
          await this.clinicSummaryService.exportPdf(user.sub, language, options)
        ).toString('base64'),
      };
    }
    return await enqueueOrFallback(
      this.clinicSummaryPdfQueueService.isConfigured,
      'clinic-summary-pdf',
      () => this.clinicSummaryPdfQueueService.enqueue(user.sub, language),
      async () =>
        (
          await this.clinicSummaryService.exportPdf(user.sub, language)
        ).toString('base64'),
      'pdfBase64',
      this.logger,
    );
  }

  @SkipThrottle()
  @Get('clinic-summary/export/status/:jobId')
  @ApiOperation({
    summary: 'Poll async clinic summary PDF export status',
  })
  @ApiResponse({
    status: 200,
    description: 'Job status (pending, completed, or failed)',
  })
  async exportClinicSummaryPdfStatus(
    @CurrentUser() user: UserPayload,
    @Param('jobId') jobId: string,
  ) {
    const status = await this.clinicSummaryPdfQueueService.getStatus(
      jobId,
      user.sub,
    );
    if (status == null) {
      return { status: 'not_found' };
    }
    return status;
  }

  @Post('clinic-summary/preview/pdf')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="clinic-summary.pdf"')
  @ApiOperation({
    summary:
      'Download a de-identified clinic summary as PDF (auth required) — ' +
      'POST so the request scope (eventId/date range + selectedFields) can ' +
      'be carried in the body, like the preview and export endpoints.',
  })
  @ApiResponse({
    status: 200,
    description: 'PDF file',
    content: { 'application/pdf': {} },
  })
  async downloadClinicSummaryPdf(
    @CurrentUser() user: UserPayload,
    @Body({ schema: clinicSummaryRequestSchema })
    dto: ClinicSummaryRequestDto,
    @I18nLang() language: string,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    const pdf = await this.clinicSummaryService.exportPdf(
      user.sub,
      language,
      this.toSummaryOptions(dto),
    );
    reply.send(pdf);
  }

  @Public()
  @Get('clinic-summary/shared/:token/pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="clinic-summary.pdf"')
  @ApiOperation({
    summary: 'Download a shared clinic summary as PDF (no auth required)',
    security: [],
  })
  @ApiResponse({
    status: 200,
    description: 'PDF file',
    content: { 'application/pdf': {} },
  })
  async downloadSharedClinicSummaryPdf(
    @Param('token') token: string,
    @I18nLang() language: string,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    const pdf = await this.clinicSummaryService.exportSharedPdf(
      token,
      language,
    );
    if (!pdf) {
      throw new HttpException(
        {
          code: 'REPORT_SHARE_NOT_FOUND',
          message: this.i18n.t('reports-clinic-summary.share_link_expired', {
            lang: language,
          }),
        },
        HttpStatus.NOT_FOUND,
      );
    }
    reply.send(pdf);
  }

  // ── Event review ─────────────────────────────────────────────────────
  // Declared before `reviews/:eventId` so the static `current` path wins.

  @Get('reviews/current')
  @ApiOperation({
    summary: 'Get the current event review for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description:
      'The current event review, or null when the user has no event review.',
  })
  @SerializeOptions({ schema: eventReviewDataSchema })
  async getCurrentReview(@CurrentUser() user: UserPayload) {
    // Prefers the active event, then the most recent ended one. No events:
    // a successful 200 response with a null resource, not a 404.
    return await this.eventReviewService.buildCurrent(user.sub);
  }

  @Get('reviews')
  @ApiOperation({ summary: 'List the user event review history' })
  @ApiResponse({
    status: 200,
    description: 'Paginated event review history.',
  })
  @SerializeOptions({ schema: eventReviewListResponseSchema })
  async listReviews(
    @CurrentUser() user: UserPayload,
    @Query({ schema: eventReviewListQuerySchema })
    query: EventReviewListQueryDto = {},
  ) {
    return await this.eventReviewService.list(user.sub, query);
  }

  @Get('reviews/:eventId')
  @ApiOperation({ summary: 'Get one user event review by event id' })
  @ApiParam({ name: 'eventId' })
  @ApiResponse({
    status: 200,
    description: 'The event review for the requested event.',
  })
  @SerializeOptions({ schema: eventReviewResponseSchema })
  async getEventReview(
    @CurrentUser() user: UserPayload,
    @Param('eventId') eventId: string,
  ) {
    return await this.eventReviewService.buildForEvent(user.sub, eventId);
  }
}

// 201/202 主成功响应注记:export-openapi 目前只把注册组件的 200 响应回写为
// $ref;以下 201/202 端点(preview/share/export-async/summary-async)的响应体
// 同样按稳定组件名登记,导出脚本支持对应状态码回写后自动生效。
registerResponseSchema({
  path: '/api/v1/user/reports/dashboard',
  method: 'get',
  componentName: 'ReportDashboardResponseDto',
  schema: reportDashboardResponseSchema,
  description: 'Report dashboard with metric/trend/finding/pattern blocks.',
});

registerResponseSchema({
  path: '/api/v1/user/reports/summary/generate',
  method: 'post',
  componentName: 'ReportSummaryResponseDto',
  schema: reportSummaryResponseSchema,
  description: 'AI report summary resource.',
});

registerResponseSchema({
  path: '/api/v1/user/reports/summary/generate/async',
  method: 'post',
  componentName: 'ReportSummaryAsyncResponseDto',
  schema: reportSummaryAsyncResponseSchema,
  description:
    'Returns either a queued jobId or the synchronous summary resource when the queue is unavailable.',
});

registerResponseSchema({
  path: '/api/v1/user/reports/clinic-summary/preview',
  method: 'post',
  componentName: 'ClinicSummaryResponseDto',
  schema: clinicSummaryResponseSchema,
  description: 'The de-identified clinic summary preview.',
});

registerResponseSchema({
  path: '/api/v1/user/reports/clinic-summary/share',
  method: 'post',
  componentName: 'ClinicSummaryShareResponseDto',
  schema: clinicSummaryShareResponseSchema,
  description: 'The created share record with its one-time token.',
});

registerResponseSchema({
  path: '/api/v1/user/reports/clinic-summary/shares',
  method: 'get',
  componentName: 'ClinicSummaryShareListResponseDto',
  schema: clinicSummaryShareListResponseSchema,
  description: 'The caller clinic-summary shares, newest first.',
});

registerResponseSchema({
  path: '/api/v1/user/reports/clinic-summary/shared/{token}',
  method: 'get',
  componentName: 'ClinicSummaryResponseDto',
  schema: clinicSummaryResponseSchema,
  description: 'The shared clinic summary.',
});

registerResponseSchema({
  path: '/api/v1/user/reports/clinic-summary/export/async',
  method: 'post',
  componentName: 'ClinicSummaryExportAsyncResponseDto',
  schema: clinicSummaryExportAsyncResponseSchema,
  description:
    'Unscoped requests use the async queue job (jobId for polling); an explicit scope is exported synchronously with the requested scope honored (pdfBase64). When no queue is configured, both paths return the base64 PDF synchronously.',
});

// GET /reviews/current returns the event review data or null — the registered
// component schema carries `.nullable()` so the 200 `$ref` keeps the
// “resource or null” semantics of the former inline nullable allOf document.
registerResponseSchema({
  path: '/api/v1/user/reports/reviews/current',
  method: 'get',
  componentName: 'EventReviewDataDto',
  schema: eventReviewNullableResponseSchema,
  description:
    'The current event review, or null when the user has no event review.',
});

registerResponseSchema({
  path: '/api/v1/user/reports/reviews',
  method: 'get',
  componentName: 'EventReviewListResponseDto',
  schema: eventReviewListResponseSchema,
  description: 'Paginated event review history.',
});

registerResponseSchema({
  path: '/api/v1/user/reports/reviews/{eventId}',
  method: 'get',
  componentName: 'EventReviewResponseDto',
  schema: eventReviewResponseSchema,
  description: 'The event review for the requested event.',
});
