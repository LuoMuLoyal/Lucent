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
import { Optional } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { I18nLang } from 'nestjs-i18n';
import {
  endSse,
  prepareSse,
  writeSseEvent,
  SseConnectionRegistry,
  SseProblemDetailsMapper,
} from '../../common/index.js';
import { extractErrorInfo } from '../../common/index.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';
import { createDomainFailure } from '../../common/result/index.js';
import { DomainFailureException } from '../../common/result/domain-failure.exception.js';
import type { UserPayload } from '../auth/index.js';
import { CurrentUser } from '../auth/index.js';
import { TodayAnalysisQueueService } from './services/analysis-queue.service.js';
import {
  TodayAnalysisMaterializationStore,
  type TodayAnalysisPendingResult,
} from './services/materialization/store.service.js';
import type { TodayAnalysisMaterializationView } from './types/materialization.types.js';

import { TodayAnalysisService } from './services/analysis.service.js';

import { TodayRecommendationsService } from './services/pipeline/recommendations.service.js';
import { generateTodayAnalysisSchema } from './dto/generate-today-analysis.dto.js';
import type { GenerateTodayAnalysisDto } from './dto/generate-today-analysis.dto.js';
import {
  todayRecommendationResponseSchema,
  todayRecommendationsResponseSchema,
} from './dto/recommendation-response.dto.js';
import {
  todayAnalysisAsyncJobDataSchema,
  todayAnalysisAsyncResultDataSchema,
  todayAnalysisAsyncStatusDataSchema,
  todayAnalysisDataSchema,
  todayAnalysisReadDataSchema,
  todayAnalysisRefreshPendingDataSchema,
  todayAnalysisRefreshReadyDataSchema,
} from './dto/analysis-response.dto.js';

@ApiTags('Today Analysis')
@ApiBearerAuth('access-token')
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
  @ApiResponse({
    status: 200,
    description: 'The latest persisted analysis with its read state.',
  })
  @SerializeOptions({ schema: todayAnalysisReadDataSchema })
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
  // 201 主成功体是四态联合(fresh analysis / read state / pending / ready)。
  // 注册器/export 现只回填 200 的单组件 $ref;此处保留联合文档,四个成员组件按
  // 旧类名在本文件尾登记,导出脚本支持 201/多态回写后自动生效。
  @ApiResponse({
    status: 201,
    description:
      'Fresh analysis, current read state, or the queued/synchronous refresh outcome.',
    schema: {
      oneOf: [
        { $ref: '#/components/schemas/TodayAnalysisDataDto' },
        { $ref: '#/components/schemas/TodayAnalysisReadDataDto' },
        {
          $ref: '#/components/schemas/TodayAnalysisRefreshPendingDataDto',
        },
        { $ref: '#/components/schemas/TodayAnalysisRefreshReadyDataDto' },
      ],
    },
  })
  async refresh(
    @CurrentUser() user: UserPayload,
    @Body({ schema: generateTodayAnalysisSchema })
    dto: GenerateTodayAnalysisDto,
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
  // 200 主成功体是二态联合(fresh analysis / read state)。注册器/export 现只
  // 回填 200 的单组件 $ref,故本端点保留联合文档;成员组件(Data/ReadData)已按
  // 旧类名在 refresh(201)登记,导出脚本支持多态回写后自动生效。
  @ApiResponse({
    status: 200,
    description:
      'The freshly generated analysis, or the current read state when a generation is already in flight.',
    schema: {
      oneOf: [
        { $ref: '#/components/schemas/TodayAnalysisDataDto' },
        { $ref: '#/components/schemas/TodayAnalysisReadDataDto' },
      ],
    },
  })
  async generate(
    @CurrentUser() user: UserPayload,
    @Body({ schema: generateTodayAnalysisSchema })
    dto: GenerateTodayAnalysisDto,
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
  // 202 主成功体是三态联合(job / synchronous result / status)。注册器/export
  // 现只回填 200,故保留联合文档;三个成员组件按旧类名在本文件尾登记(202 锚点),
  // 导出脚本支持 202/多态回写后自动生效。
  @ApiResponse({
    status: 202,
    description:
      'Job enqueued. Returns jobId, or the synchronous result/status when the queue is unavailable.',
    schema: {
      oneOf: [
        { $ref: '#/components/schemas/TodayAnalysisAsyncJobDataDto' },
        { $ref: '#/components/schemas/TodayAnalysisAsyncResultDataDto' },
        { $ref: '#/components/schemas/TodayAnalysisAsyncStatusDataDto' },
      ],
    },
  })
  async generateAsync(
    @CurrentUser() user: UserPayload,
    @Body({ schema: generateTodayAnalysisSchema })
    dto: GenerateTodayAnalysisDto,
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
  // NOTE: JSON array body. Outbound validation uses the item schema (the
  // global serializer validates array items one by one); the OpenAPI
  // registration below uses the array schema.
  @ApiResponse({
    status: 200,
    description: 'Cold-start onboarding guide cards.',
  })
  @SerializeOptions({ schema: todayRecommendationResponseSchema })
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
    @Body({ schema: generateTodayAnalysisSchema })
    dto: GenerateTodayAnalysisDto,
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

registerResponseSchema({
  path: '/api/v1/user/today-analysis',
  method: 'get',
  componentName: 'TodayAnalysisReadResponseDto',
  schema: todayAnalysisReadDataSchema,
  description: 'The latest persisted analysis with its read state.',
});

// NOTE: array body — the component schema is the full response array (the
// 200 schema is rewritten to `$ref` this component by the export hook);
// runtime outbound validation uses the item schema on the handler.
registerResponseSchema({
  path: '/api/v1/user/today-analysis/recommendations',
  method: 'get',
  componentName: 'TodayRecommendationResponseDto',
  schema: todayRecommendationsResponseSchema,
  description: 'Cold-start onboarding guide cards.',
});

// 联合端点成员组件登记(refresh 201 / generate 200 / generate/async 202 的
// oneOf 分支引用这些稳定组件名)。refresh 与 async 无 200 响应,export 现不会
// 重写其响应;generate(200)未在此登记,避免其联合 200 被单组件 $ref 覆盖。
registerResponseSchema({
  path: '/api/v1/user/today-analysis/refresh',
  method: 'post',
  componentName: 'TodayAnalysisDataDto',
  schema: todayAnalysisDataSchema,
  description: 'A freshly generated Today AI analysis resource.',
});

registerResponseSchema({
  path: '/api/v1/user/today-analysis/refresh',
  method: 'post',
  componentName: 'TodayAnalysisReadDataDto',
  schema: todayAnalysisReadDataSchema,
  description: 'The persisted analysis read state.',
});

registerResponseSchema({
  path: '/api/v1/user/today-analysis/refresh',
  method: 'post',
  componentName: 'TodayAnalysisRefreshPendingDataDto',
  schema: todayAnalysisRefreshPendingDataSchema,
  description: 'The enqueued refresh outcome.',
});

registerResponseSchema({
  path: '/api/v1/user/today-analysis/refresh',
  method: 'post',
  componentName: 'TodayAnalysisRefreshReadyDataDto',
  schema: todayAnalysisRefreshReadyDataSchema,
  description: 'The synchronous refresh outcome.',
});

registerResponseSchema({
  path: '/api/v1/user/today-analysis/generate/async',
  method: 'post',
  componentName: 'TodayAnalysisAsyncJobDataDto',
  schema: todayAnalysisAsyncJobDataSchema,
  description: 'The enqueued async generation job.',
});

registerResponseSchema({
  path: '/api/v1/user/today-analysis/generate/async',
  method: 'post',
  componentName: 'TodayAnalysisAsyncResultDataDto',
  schema: todayAnalysisAsyncResultDataSchema,
  description: 'The synchronous async-endpoint result.',
});

registerResponseSchema({
  path: '/api/v1/user/today-analysis/generate/async',
  method: 'post',
  componentName: 'TodayAnalysisAsyncStatusDataDto',
  schema: todayAnalysisAsyncStatusDataSchema,
  description: 'The async job status payload.',
});

interface ManualGenerationRequest {
  date: string;
  current: TodayAnalysisMaterializationView;
  pending: TodayAnalysisPendingResult | null;
}
