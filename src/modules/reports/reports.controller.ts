import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Res,
  SerializeOptions,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { I18nLang } from 'nestjs-i18n';

import { registerResponseSchema } from '../../common/api/response-schema.registry.js';
import {
  endSse,
  prepareSse,
  SseProblemDetailsMapper,
  writeSseEvent,
  SseConnectionRegistry,
} from '../../common/index.js';
import type { UserPayload } from '../auth/index.js';
import { CurrentUser } from '../auth/index.js';

import { generateReportSummarySchema } from './dto/generate-report-summary.dto.js';
import type { GenerateReportSummaryDto } from './dto/generate-report-summary.dto.js';

import { reportDashboardQuerySchema } from './dto/report-dashboard-query.dto.js';
import type { ReportDashboardQueryDto } from './dto/report-dashboard-query.dto.js';

import { reportDashboardResponseSchema } from './dto/report-dashboard-response.dto.js';

import {
  reportSummaryAsyncResponseSchema,
  reportSummaryResponseSchema,
} from './dto/report-summary-response.dto.js';

import { ReportSummaryQueueService } from './services/ai-summary/summary-queue.service.js';
import { ReportsAiSummaryService } from './services/ai-summary/summary.service.js';
import { ReportsService } from './dashboard/dashboard.service.js';

@ApiTags('Reports')
@ApiBearerAuth('access-token')
@Controller('reports')
export class ReportsController {
  private readonly logger = new Logger(ReportsController.name);

  constructor(
    private readonly reportsService: ReportsService,
    private readonly reportsAiSummaryService: ReportsAiSummaryService,
    private readonly reportSummaryQueueService: ReportSummaryQueueService,
    private readonly sseRegistry: SseConnectionRegistry,
    private readonly sseProblemDetails: SseProblemDetailsMapper,
  ) {}

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
    summary: 'Enqueue AI report summary generation (async)',
  })
  @ApiResponse({
    status: 201,
    description:
      'When a queue is configured, accepted with a `jobId` for polling; ' +
      'otherwise the summary is generated synchronously and returned.',
  })
  @SerializeOptions({ schema: reportSummaryAsyncResponseSchema })
  async generateSummaryAsync(
    @CurrentUser() user: UserPayload,
    @Body({ schema: generateReportSummarySchema })
    dto: GenerateReportSummaryDto,
    @I18nLang() language: string,
  ) {
    const jobId = await this.reportSummaryQueueService.enqueue(
      user.sub,
      dto,
      language,
    );
    if (jobId != null) {
      return {
        jobId,
        status: 'queued' as const,
      };
    }

    return {
      data: await this.reportsAiSummaryService.generate(
        user.sub,
        dto,
        language,
      ),
    };
  }

  @SkipThrottle()
  @Get('summary/generate/status/:jobId')
  @ApiOperation({ summary: 'Poll AI report summary generation status' })
  @ApiParam({ name: 'jobId' })
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

  @Post('summary/generate/stream')
  @ApiOperation({
    summary: 'Stream AI report summary generation events (SSE)',
    description:
      'Progress events (`progress`), LLM partials (`chunk`), a final ' +
      '`result` when ready, and an `error` event on failure.',
  })
  @ApiResponse({ status: 200, description: 'SSE stream of summary events.' })
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
        (event) => {
          writeSseEvent(reply.raw, {
            event: 'summary',
            data: event,
          });
        },
      );
      writeSseEvent(reply.raw, {
        event: 'result',
        data: result,
      });
    } catch (error: unknown) {
      this.logger.error('Report summary stream failed', error);
      writeSseEvent(reply.raw, {
        event: 'error',
        data: this.sseProblemDetails.build(error, { lang: language }),
      });
    } finally {
      writeSseEvent(reply.raw, { event: 'done', data: null });
      endSse(reply.raw, this.sseRegistry);
    }
  }
}

registerResponseSchema({
  path: '/api/v1/user/reports/dashboard',
  method: 'get',
  componentName: 'ReportDashboardResponse',
  schema: reportDashboardResponseSchema,
  description: 'Report dashboard with blocks of metrics, trends and patterns.',
});

registerResponseSchema({
  path: '/api/v1/user/reports/summary/generate',
  method: 'post',
  componentName: 'ReportSummaryResponse',
  schema: reportSummaryResponseSchema,
  description: 'AI report summary resource.',
});

registerResponseSchema({
  path: '/api/v1/user/reports/summary/generate/async',
  method: 'post',
  componentName: 'ReportSummaryAsyncResponseData',
  schema: reportSummaryAsyncResponseSchema,
  description:
    'Async generation accepted (returns a jobId for polling) or returned synchronously.',
});

registerResponseSchema({
  path: '/api/v1/user/reports/summary/generate/stream',
  method: 'post',
  componentName: 'ReportSummaryStreamResponse',
  description: 'SSE stream of summary progress/result events.',
  schema: reportSummaryResponseSchema,
});
