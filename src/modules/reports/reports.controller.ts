import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { I18nLang, I18nService } from 'nestjs-i18n';

import {
  successEnvelope,
  endSse,
  prepareSse,
  writeSseEvent,
  SseConnectionRegistry,
} from '../../common';
import {
  extractErrorInfo,
  httpExceptionPayload,
  enqueueOrFallback,
} from '../../common';
import { SkipApiEnvelope } from '../../common';
import type { UserPayload } from '../auth';
import { CurrentUser } from '../auth';

import { Public } from '../auth';
import { GenerateReportSummaryDto } from './dto/generate-report-summary.dto';

import { ReportDashboardQueryDto } from './dto/report-dashboard-query.dto';

import { ReportDashboardResponseDto } from './dto/report-dashboard-response.dto';

import { ReportSummaryResponseDto } from './dto/report-summary-response.dto';

import {
  ClinicSummaryDto,
  ClinicSummaryShareResponseDto,
} from './dto/clinic-summary-response.dto';
import { ReportSummaryQueueService } from './services/ai-summary/summary-queue.service';

import { ReportsAiSummaryService } from './services/ai-summary/summary.service';
import { ClinicSummaryPdfQueueService } from './services/clinic-summary/pdf-queue.service';

import { ClinicSummaryService } from './services/clinic-summary/summary.service';
import { ReportsService } from './dashboard/dashboard.service';

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
    private readonly sseRegistry: SseConnectionRegistry,
    private readonly i18n: I18nService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get authenticated user report dashboard' })
  @ApiResponse({ status: 200, type: ReportDashboardResponseDto })
  async getDashboard(
    @CurrentUser() user: UserPayload,
    @Query() query: ReportDashboardQueryDto,
    @I18nLang() language: string,
  ) {
    return successEnvelope(
      await this.reportsService.getDashboard(user.sub, query, language),
    );
  }

  @Post('summary/generate')
  @ApiOperation({
    summary: 'Generate authenticated user AI summary for report',
  })
  @ApiResponse({ status: 200, type: ReportSummaryResponseDto })
  async generateSummary(
    @CurrentUser() user: UserPayload,
    @Body() dto: GenerateReportSummaryDto,
    @I18nLang() language: string,
  ) {
    return successEnvelope(
      await this.reportsAiSummaryService.generate(user.sub, dto, language),
    );
  }

  @Post('summary/generate/async')
  @ApiOperation({
    summary: 'Enqueue async AI summary generation for report',
  })
  @ApiResponse({
    status: 202,
    description: 'Job enqueued. Returns jobId for polling.',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'number', example: 0 },
        data: {
          type: 'object',
          properties: {
            jobId: { type: 'string' },
          },
        },
      },
    },
  })
  async generateSummaryAsync(
    @CurrentUser() user: UserPayload,
    @Body() dto: GenerateReportSummaryDto,
    @I18nLang() language: string,
  ) {
    return successEnvelope(
      await enqueueOrFallback(
        this.reportSummaryQueueService.isConfigured,
        'report-summary',
        () => this.reportSummaryQueueService.enqueue(user.sub, dto, language),
        () => this.reportsAiSummaryService.generate(user.sub, dto, language),
        'result',
      ),
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
      return successEnvelope({ status: 'not_found' });
    }
    return successEnvelope(status);
  }

  @SkipThrottle()
  @Post('summary/generate/stream')
  @SkipApiEnvelope()
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
    @Body() dto: GenerateReportSummaryDto,
    @I18nLang() language: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    prepareSse(reply.raw, this.sseRegistry);

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
        data: httpExceptionPayload(error),
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
  @ApiResponse({ status: 200, type: ClinicSummaryDto })
  async previewClinicSummary(
    @CurrentUser() user: UserPayload,
    @I18nLang() language: string,
  ) {
    return successEnvelope(
      await this.clinicSummaryService.buildClinicSummary(user.sub, language),
    );
  }

  @Post('clinic-summary/share')
  @ApiOperation({
    summary: 'Create a shareable link for the clinic summary (24h expiry)',
  })
  @ApiResponse({ status: 200, type: ClinicSummaryShareResponseDto })
  async shareClinicSummary(
    @CurrentUser() user: UserPayload,
    @I18nLang() language: string,
  ) {
    return successEnvelope(
      await this.clinicSummaryService.createShareLink(user.sub, language),
    );
  }

  @Public()
  @Get('clinic-summary/shared/:token')
  @ApiOperation({
    summary: 'Access a shared clinic summary by token (no auth required)',
  })
  @ApiResponse({ status: 200, type: ClinicSummaryDto })
  async getSharedClinicSummary(
    @Param('token') token: string,
    @I18nLang() language: string,
  ) {
    const summary = await this.clinicSummaryService.getSharedSummary(token);
    if (!summary) {
      throw new HttpException(
        await this.i18n.t('reports-clinic-summary.share_link_expired', {
          lang: language,
        }),
        HttpStatus.GONE,
      );
    }
    return successEnvelope(summary);
  }

  @Post('clinic-summary/export/async')
  @ApiOperation({
    summary: 'Enqueue async clinic summary PDF export',
  })
  @ApiResponse({
    status: 202,
    description: 'Job enqueued. Returns jobId for polling.',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'number', example: 0 },
        data: {
          type: 'object',
          properties: {
            jobId: { type: 'string' },
          },
        },
      },
    },
  })
  async exportClinicSummaryPdfAsync(
    @CurrentUser() user: UserPayload,
    @I18nLang() language: string,
  ) {
    return successEnvelope(
      await enqueueOrFallback(
        this.clinicSummaryPdfQueueService.isConfigured,
        'clinic-summary-pdf',
        () => this.clinicSummaryPdfQueueService.enqueue(user.sub, language),
        async () =>
          (
            await this.clinicSummaryService.exportPdf(user.sub, language)
          ).toString('base64'),
        'pdfBase64',
      ),
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
      return successEnvelope({ status: 'not_found' });
    }
    return successEnvelope(status);
  }

  @Get('clinic-summary/preview/pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="clinic-summary.pdf"')
  @ApiOperation({
    summary: 'Download a de-identified clinic summary as PDF (auth required)',
  })
  @ApiResponse({
    status: 200,
    description: 'PDF file',
    content: { 'application/pdf': {} },
  })
  async downloadClinicSummaryPdf(
    @CurrentUser() user: UserPayload,
    @I18nLang() language: string,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    const pdf = await this.clinicSummaryService.exportPdf(user.sub, language);
    reply.send(pdf);
  }

  @Public()
  @Get('clinic-summary/shared/:token/pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="clinic-summary.pdf"')
  @ApiOperation({
    summary: 'Download a shared clinic summary as PDF (no auth required)',
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
        await this.i18n.t('reports-clinic-summary.share_link_expired', {
          lang: language,
        }),
        HttpStatus.GONE,
      );
    }
    reply.send(pdf);
  }
}
