import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Optional } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { I18nLang } from 'nestjs-i18n';
import {
  endSse,
  prepareSse,
  writeSseEvent,
  SseConnectionRegistry,
  SseProblemDetailsMapper,
} from '../../common';
import { extractErrorInfo } from '../../common';
import { createDomainFailure } from '../../common/result';
import { DomainFailureException } from '../../common/result/domain-failure.exception';
import type { UserPayload } from '../auth';
import { CurrentUser } from '../auth';
import { TodayAnalysisQueueService } from './services/analysis-queue.service';
import {
  TodayAnalysisMaterializationStore,
  type TodayAnalysisPendingResult,
} from './services/materialization/store.service';
import type { TodayAnalysisMaterializationView } from './types/materialization.types';

import { TodayAnalysisService } from './services/analysis.service';

import { TodayRecommendationsService } from './services/pipeline/recommendations.service';
import { GenerateTodayAnalysisDto } from './dto/generate-today-analysis.dto';

import {
  TodayAnalysisAsyncJobDataDto,
  TodayAnalysisAsyncResultDataDto,
  TodayAnalysisAsyncStatusDataDto,
  TodayAnalysisReadResponseDto,
  TodayAnalysisRefreshPendingDataDto,
  TodayAnalysisRefreshReadyDataDto,
  TodayAnalysisDataDto,
  TodayAnalysisReadDataDto,
} from './dto/analysis-response.dto';
import {
  TodayAnalysisStreamErrorDto,
  TodayAnalysisStreamResultDto,
  TodayAnalysisStreamSummaryDto,
} from './dto/analysis-stream-response.dto';

import { TodayRecommendationResponseDto } from './dto/recommendation-response.dto';

@ApiTags('Today Analysis')
@ApiBearerAuth('access-token')
@ApiExtraModels(
  TodayAnalysisAsyncJobDataDto,
  TodayAnalysisAsyncResultDataDto,
  TodayAnalysisAsyncStatusDataDto,
  TodayAnalysisDataDto,
  TodayAnalysisReadDataDto,
  TodayAnalysisReadResponseDto,
  TodayAnalysisRefreshPendingDataDto,
  TodayAnalysisRefreshReadyDataDto,
  TodayAnalysisStreamErrorDto,
  TodayAnalysisStreamResultDto,
  TodayAnalysisStreamSummaryDto,
)
@Controller('today-analysis')
export class TodayAnalysisController {
  private readonly logger = new Logger(TodayAnalysisController.name);

  constructor(
    private readonly todayAnalysisService: TodayAnalysisService,
    private readonly todayRecommendationsService: TodayRecommendationsService,
    private readonly todayAnalysisQueueService: TodayAnalysisQueueService,
    private readonly sseRegistry: SseConnectionRegistry,
    private readonly sseProblemDetails: SseProblemDetailsMapper,
    @Optional()
    private readonly materializationStore?: TodayAnalysisMaterializationStore,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Read the latest persisted Today AI analysis' })
  @ApiQuery({ name: 'date', required: false, type: String })
  @ApiResponse({ status: 200, type: TodayAnalysisReadResponseDto })
  async read(
    @CurrentUser() user: UserPayload,
    @Query('date') date: string | undefined,
    @I18nLang() language: string,
  ) {
    const resolvedDate = await this.todayAnalysisService.resolveDate(
      user.sub,
      date,
    );
    return this.todayAnalysisService.readCurrent(
      user.sub,
      resolvedDate,
      language,
    );
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Request a bounded Today AI analysis refresh' })
  @ApiResponse({
    status: 201,
    schema: {
      oneOf: [
        { $ref: getSchemaPath(TodayAnalysisDataDto) },
        { $ref: getSchemaPath(TodayAnalysisReadDataDto) },
        { $ref: getSchemaPath(TodayAnalysisRefreshPendingDataDto) },
        { $ref: getSchemaPath(TodayAnalysisRefreshReadyDataDto) },
      ],
    },
  })
  async refresh(
    @CurrentUser() user: UserPayload,
    @Body() dto: GenerateTodayAnalysisDto,
    @I18nLang() language: string,
  ) {
    const request = await this.prepareManualRequest(user.sub, dto);
    if (request == null) {
      return this.todayAnalysisService.generate(user.sub, dto, language);
    }

    if (request.pending == null || !request.pending.shouldQueue) {
      return this.todayAnalysisService.readCurrent(
        user.sub,
        request.date,
        language,
      );
    }

    if (this.todayAnalysisQueueService.isConfigured) {
      const jobId = await this.todayAnalysisQueueService.enqueue(
        user.sub,
        { date: request.date },
        language,
        request.pending.sourceVersion,
        'manual_refresh',
        request.pending.lastTriggerKey ?? undefined,
      );
      if (jobId != null) {
        return { status: 'pending', jobId };
      }
    }

    const data = await this.todayAnalysisService.generateForVersion(
      user.sub,
      { date: request.date },
      language,
      request.pending.sourceVersion,
    );
    if ('status' in data) {
      return data;
    }
    return { status: 'ready', analysis: data };
  }

  @Post('generate')
  @ApiOperation({ summary: 'Generate authenticated user today AI analysis' })
  @ApiResponse({
    status: 200,
    schema: {
      oneOf: [
        { $ref: getSchemaPath(TodayAnalysisDataDto) },
        { $ref: getSchemaPath(TodayAnalysisReadDataDto) },
      ],
    },
  })
  async generate(
    @CurrentUser() user: UserPayload,
    @Body() dto: GenerateTodayAnalysisDto,
    @I18nLang() language: string,
  ) {
    const request = await this.prepareManualRequest(user.sub, dto);
    if (request != null) {
      if (request.pending == null || !request.pending.shouldQueue) {
        return this.todayAnalysisService.readCurrent(
          user.sub,
          request.date,
          language,
        );
      }
      const data = await this.todayAnalysisService.generateForVersion(
        user.sub,
        { date: request.date },
        language,
        request.pending.sourceVersion,
      );
      if ('status' in data) {
        return data;
      }
      return data;
    }

    return this.todayAnalysisService.generate(user.sub, dto, language);
  }

  @Post('generate/async')
  @ApiOperation({ summary: 'Enqueue async today AI analysis generation' })
  @ApiResponse({
    status: 202,
    description: 'Job enqueued. Returns jobId for polling.',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(TodayAnalysisAsyncJobDataDto) },
        { $ref: getSchemaPath(TodayAnalysisAsyncResultDataDto) },
        { $ref: getSchemaPath(TodayAnalysisAsyncStatusDataDto) },
      ],
    },
  })
  async generateAsync(
    @CurrentUser() user: UserPayload,
    @Body() dto: GenerateTodayAnalysisDto,
    @I18nLang() language: string,
  ) {
    const request = await this.prepareManualRequest(user.sub, dto);
    if (request != null) {
      if (request.pending == null || !request.pending.shouldQueue) {
        return { status: request.current.status };
      }
      if (this.todayAnalysisQueueService.isConfigured) {
        const jobId = await this.todayAnalysisQueueService.enqueue(
          user.sub,
          { date: request.date },
          language,
          request.pending.sourceVersion,
          'manual_refresh',
          request.pending.lastTriggerKey ?? undefined,
        );
        if (jobId != null) {
          return { jobId };
        }
      }
      const result = await this.todayAnalysisService.generateForVersion(
        user.sub,
        { date: request.date },
        language,
        request.pending.sourceVersion,
      );
      return { result };
    }

    if (this.todayAnalysisQueueService.isConfigured) {
      const jobId = await this.todayAnalysisQueueService.enqueue(
        user.sub,
        dto,
        language,
      );
      if (jobId != null) {
        return { jobId };
      }
    }

    // Fallback: run synchronously when Redis is not available
    const result = await this.todayAnalysisService.generate(
      user.sub,
      dto,
      language,
    );
    return { result };
  }

  @SkipThrottle()
  @Get('generate/status/:jobId')
  @ApiOperation({ summary: 'Poll async today analysis generation status' })
  @ApiResponse({
    status: 200,
    description: 'Job status (pending, completed, or failed)',
  })
  async generateStatus(@Param('jobId') jobId: string) {
    const status = await this.todayAnalysisQueueService.getStatus(jobId);
    if (status == null) {
      return { status: 'not_found' };
    }
    return status;
  }

  @Get('recommendations')
  @ApiOperation({ summary: 'Get cold-start onboarding guide cards' })
  @ApiQuery({
    name: 'exclude',
    required: false,
    isArray: true,
    type: String,
    description: 'Guide IDs from the last response, used for deduplication',
  })
  @ApiResponse({
    status: 200,
    type: TodayRecommendationResponseDto,
    isArray: true,
  })
  getRecommendations(
    @Query('exclude') exclude?: string | string[],
    @I18nLang() lang?: string,
  ) {
    const normalizedExclude = Array.isArray(exclude)
      ? exclude
      : exclude
        ? [exclude]
        : [];
    const guides = this.todayRecommendationsService.getColdStartGuides(
      normalizedExclude,
      lang,
    );
    return guides;
  }

  @SkipThrottle()
  @Post('generate/stream')
  @ApiOperation({
    summary: 'Stream authenticated user today AI analysis generation',
  })
  @ApiResponse({
    status: 200,
    description:
      'Server-Sent Events stream without the API envelope. Each event has an "event" field (summary | result | error | done) and a JSON "data" field. Parsed event data follows TodayAnalysisStreamResultDto.',
    content: {
      'text/event-stream': {
        schema: {
          type: 'string',
          description:
            'Each frame is UTF-8 SSE text. event=summary data={summary}; event=result data=TodayAnalysisDataDto; event=error data=TodayAnalysisStreamErrorDto; event=done data={}.',
        },
      },
    },
  })
  async generateStream(
    @CurrentUser() user: UserPayload,
    @Body() dto: GenerateTodayAnalysisDto,
    @I18nLang() language: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    prepareSse(reply.raw, this.sseRegistry, language);

    try {
      const onSummary = ({ summary }: { summary: string }) => {
        writeSseEvent(reply.raw, {
          event: 'summary',
          data: { summary },
        });
      };
      const request = await this.prepareManualRequest(user.sub, dto);
      const result =
        request == null
          ? await this.todayAnalysisService.generateStream(
              user.sub,
              dto,
              language,
              onSummary,
            )
          : request.pending == null || !request.pending.shouldQueue
            ? await this.readStreamFallback(
                user.sub,
                request.date,
                language,
                onSummary,
              )
            : await this.todayAnalysisService.generateStreamForVersion(
                user.sub,
                { date: request.date },
                language,
                request.pending.sourceVersion,
                onSummary,
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
        `Today analysis stream failed for user ${user.sub}: ${reason}`,
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

  private async prepareManualRequest(
    userId: string,
    dto: GenerateTodayAnalysisDto,
  ): Promise<ManualGenerationRequest | null> {
    const store = this.materializationStore;
    if (store == null) return null;

    const date = await this.todayAnalysisService.resolveDate(userId, dto.date);
    const current = await store.readStatus(userId, date);
    if (store.isRefreshCoolingDown(current)) {
      return { date, current, pending: null };
    }

    const pending = await store.markPending({
      userId,
      localDate: date,
      reasonCode: 'manual_refresh',
      manual: true,
      triggerKey: `manual-refresh:${date}:${String(current.sourceVersion + 1)}`,
    });
    return { date, current, pending };
  }

  private async readStreamFallback(
    userId: string,
    date: string,
    language: string,
    onSummary: ({ summary }: { summary: string }) => void,
  ): Promise<
    NonNullable<
      Awaited<ReturnType<TodayAnalysisService['readCurrent']>>['analysis']
    >
  > {
    const current = await this.todayAnalysisService.readCurrent(
      userId,
      date,
      language,
    );
    if (current.analysis == null) {
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'conflict',
          code: 'RESOURCE_CONFLICT',
          detail: `TODAY_ANALYSIS_${current.status.toUpperCase()}`,
        }),
      );
    }
    onSummary({ summary: current.analysis.summary });
    return current.analysis;
  }
}

interface ManualGenerationRequest {
  date: string;
  current: TodayAnalysisMaterializationView;
  pending: TodayAnalysisPendingResult | null;
}
