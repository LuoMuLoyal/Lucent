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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { I18nLang } from 'nestjs-i18n';

import { successEnvelope } from '../../common/api';
import { extractErrorInfo } from '../../common/helpers/error-info.utils';
import { httpExceptionPayload } from '../../common/helpers/error-payload';
import { enqueueOrFallback } from '../../common/helpers/queue-helpers';
import { SkipApiEnvelope } from '../../common/interceptors/skip-api-envelope.decorator';
import { endSse, prepareSse, writeSseEvent } from '../../common/api/sse';
import { type UserPayload } from '../auth/types/auth-request';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  GenerateReportSummaryDto,
  ReportDashboardQueryDto,
  ReportDashboardResponseDto,
  ReportSummaryResponseDto,
  ClinicSummaryDto,
  ClinicSummaryShareResponseDto,
} from './dto';
import { ReportsAiSummaryService } from './services/ai-summary/summary.service';
import { ReportSummaryQueueService } from './services/ai-summary/summary-queue.service';
import { ClinicSummaryService } from './services/clinic-summary/summary.service';
import { ClinicSummaryPdfQueueService } from './services/clinic-summary/pdf-queue.service';
import { ReportsService } from './dashboard/dashboard.service';

@ApiTags('Reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  private readonly logger = new Logger(ReportsController.name);

  constructor(
    private readonly reportsService: ReportsService,
    private readonly reportsAiSummaryService: ReportsAiSummaryService,
    private readonly reportSummaryQueueService: ReportSummaryQueueService,
    private readonly clinicSummaryService: ClinicSummaryService,
    private readonly clinicSummaryPdfQueueService: ClinicSummaryPdfQueueService,
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
        () => this.reportSummaryQueueService.enqueue(user.sub, dto, language),
        () => this.reportsAiSummaryService.generate(user.sub, dto, language),
        'result',
      ),
    );
  }

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
    @Res() response: Response,
  ): Promise<void> {
    prepareSse(response);

    try {
      const result = await this.reportsAiSummaryService.generateStream(
        user.sub,
        dto,
        language,
        ({ summary }) => {
          writeSseEvent(response, {
            event: 'summary',
            data: { summary },
          });
        },
      );

      writeSseEvent(response, {
        event: 'result',
        data: result,
      });
      writeSseEvent(response, {
        event: 'done',
        data: {},
      });
    } catch (error) {
      const { message: reason, stack } = extractErrorInfo(error);
      this.logger.error(
        `Report summary stream failed for user ${user.sub}: ${reason}`,
        stack,
      );
      writeSseEvent(response, {
        event: 'error',
        data: httpExceptionPayload(error),
      });
    } finally {
      endSse(response);
    }
  }

  @Post('clinic-summary/preview')
  @ApiOperation({
    summary:
      'Generate a de-identified clinic summary for sharing with a doctor',
  })
  @ApiResponse({ status: 200, type: ClinicSummaryDto })
  async previewClinicSummary(@CurrentUser() user: UserPayload) {
    return successEnvelope(
      await this.clinicSummaryService.buildClinicSummary(user.sub),
    );
  }

  @Post('clinic-summary/share')
  @ApiOperation({
    summary: 'Create a shareable link for the clinic summary (24h expiry)',
  })
  @ApiResponse({ status: 200, type: ClinicSummaryShareResponseDto })
  async shareClinicSummary(@CurrentUser() user: UserPayload) {
    return successEnvelope(
      await this.clinicSummaryService.createShareLink(user.sub),
    );
  }

  @Public()
  @Get('clinic-summary/shared/:token')
  @ApiOperation({
    summary: 'Access a shared clinic summary by token (no auth required)',
  })
  @ApiResponse({ status: 200, type: ClinicSummaryDto })
  async getSharedClinicSummary(@Param('token') token: string) {
    const summary = await this.clinicSummaryService.getSharedSummary(token);
    if (!summary) {
      throw new HttpException(
        'Share link expired or invalid.',
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
        () => this.clinicSummaryPdfQueueService.enqueue(user.sub, language),
        async () =>
          (
            await this.clinicSummaryService.exportPdf(user.sub, language)
          ).toString('base64'),
        'pdfBase64',
      ),
    );
  }

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
    @Res({ passthrough: false }) response: Response,
  ): Promise<void> {
    const pdf = await this.clinicSummaryService.exportPdf(user.sub, language);
    response.send(pdf);
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
    @Res({ passthrough: false }) response: Response,
  ): Promise<void> {
    const pdf = await this.clinicSummaryService.exportSharedPdf(
      token,
      language,
    );
    if (!pdf) {
      throw new HttpException(
        'Share link expired or invalid.',
        HttpStatus.GONE,
      );
    }
    response.send(pdf);
  }
}
