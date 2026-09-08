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
import { enqueueOrFallback } from '../../common/index.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';
import type { UserPayload } from '../auth/index.js';
import { CurrentUser, Public } from '../auth/index.js';

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
import { ClinicSummaryPdfQueueService } from './services/clinic-summary/pdf-queue.service.js';
import { ClinicSummaryPdfService } from './services/clinic-summary/pdf.service.js';
import {
  ClinicSummaryService,
  sharedSummaryCacheKey,
} from './services/clinic-summary/summary.service.js';
import type { ClinicSummaryOptions } from './services/clinic-summary/summary.service.js';
import { ShareService } from './services/clinic-summary/share.service.js';

/** Milliseconds per day — used to materialize the default share range. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

@ApiTags('Reports')
@ApiBearerAuth('access-token')
@Controller('reports')
export class ClinicSummaryController {
  private readonly logger = new Logger(ClinicSummaryController.name);

  /**
   * TTL of the shared summary view cached under the share token at create
   * time. Mirrors `ShareService.DEFAULT_SHARE_TTL_DAYS` (7 days) so the
   * cached copy never outlives the persisted grant and the grant never
   * outlives the copy — `ClinicSummaryService.getSharedSummary` (the single
   * public-read gate) still re-checks revokedAt/expiresAt before serving.
   */
  private static readonly SHARED_VIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly clinicSummaryService: ClinicSummaryService,
    private readonly clinicSummaryPdfService: ClinicSummaryPdfService,
    private readonly clinicSummaryPdfQueueService: ClinicSummaryPdfQueueService,
    private readonly shareService: ShareService,
    private readonly i18n: I18nService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
  ) {}

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
        ClinicSummaryController.SHARED_VIEW_TTL_MS,
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
          await this.clinicSummaryPdfService.exportPdf(
            user.sub,
            language,
            options,
          )
        ).toString('base64'),
      };
    }
    return await enqueueOrFallback(
      this.clinicSummaryPdfQueueService.isConfigured,
      'clinic-summary-pdf',
      () => this.clinicSummaryPdfQueueService.enqueue(user.sub, language),
      async () =>
        (
          await this.clinicSummaryPdfService.exportPdf(user.sub, language)
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
    const pdf = await this.clinicSummaryPdfService.exportPdf(
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
    const pdf = await this.clinicSummaryPdfService.exportSharedPdf(
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
}

registerResponseSchema({
  path: '/api/v1/user/reports/clinic-summary/preview',
  method: 'post',
  componentName: 'ClinicSummaryResponse',
  schema: clinicSummaryResponseSchema,
  description: 'The de-identified clinic summary preview.',
});

registerResponseSchema({
  path: '/api/v1/user/reports/clinic-summary/share',
  method: 'post',
  componentName: 'ClinicSummaryShareResponse',
  schema: clinicSummaryShareResponseSchema,
  description: 'The created share record with its one-time token.',
});

registerResponseSchema({
  path: '/api/v1/user/reports/clinic-summary/shares',
  method: 'get',
  componentName: 'ClinicSummaryShareListResponse',
  schema: clinicSummaryShareListResponseSchema,
  description: 'The caller clinic-summary shares, newest first.',
});

registerResponseSchema({
  path: '/api/v1/user/reports/clinic-summary/shared/{token}',
  method: 'get',
  componentName: 'ClinicSummaryResponse',
  schema: clinicSummaryResponseSchema,
  description: 'The shared clinic summary.',
});

registerResponseSchema({
  path: '/api/v1/user/reports/clinic-summary/export/async',
  method: 'post',
  componentName: 'ClinicSummaryExportJobResponse',
  schema: clinicSummaryExportAsyncResponseSchema,
  description:
    'Unscoped requests use the async queue job (jobId for polling); an explicit scope is exported synchronously with the requested scope honored (pdfBase64). When no queue is configured, both paths return the base64 PDF synchronously.',
});
