import {
  Body,
  Controller,
  Get,
  HttpException,
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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { I18nLang } from 'nestjs-i18n';
import { successEnvelope } from '../../common/api';
import { endSse, prepareSse, writeSseEvent } from '../../common/api/sse';
import { SseConnectionRegistry } from '../../common/api/sse-connection-registry.service';
import { extractErrorInfo } from '../../common/helpers/error-info.utils';
import { SkipApiEnvelope } from '../../common/interceptors/skip-api-envelope.decorator';
import { type UserPayload } from '../auth/types/auth-request';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TodayAnalysisService } from './services/analysis.service';
import { TodayAnalysisQueueService } from './services/analysis-queue.service';
import { TodayRecommendationsService } from './services/recommendations.service';
import {
  GenerateTodayAnalysisDto,
  TodayAnalysisResponseDto,
  TodayRecommendationResponseDto,
} from './dto';

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
  ) {}

  @Post('generate')
  @ApiOperation({ summary: 'Generate authenticated user today AI analysis' })
  @ApiResponse({ status: 200, type: TodayAnalysisResponseDto })
  async generate(
    @CurrentUser() user: UserPayload,
    @Body() dto: GenerateTodayAnalysisDto,
    @I18nLang() language: string,
  ) {
    return successEnvelope(
      await this.todayAnalysisService.generate(user.sub, dto, language),
    );
  }

  @Post('generate/async')
  @ApiOperation({ summary: 'Enqueue async today AI analysis generation' })
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
  async generateAsync(
    @CurrentUser() user: UserPayload,
    @Body() dto: GenerateTodayAnalysisDto,
    @I18nLang() language: string,
  ) {
    if (this.todayAnalysisQueueService.isConfigured) {
      const jobId = await this.todayAnalysisQueueService.enqueue(
        user.sub,
        dto,
        language,
      );
      if (jobId != null) {
        return successEnvelope({ jobId });
      }
    }

    // Fallback: run synchronously when Redis is not available
    const result = await this.todayAnalysisService.generate(
      user.sub,
      dto,
      language,
    );
    return successEnvelope({ result });
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
      return successEnvelope({ status: 'not_found' });
    }
    return successEnvelope(status);
  }

  @Get('recommendations')
  @ApiOperation({ summary: 'Get random daily health recommendations' })
  @ApiQuery({
    name: 'exclude',
    required: false,
    isArray: true,
    type: String,
    description:
      'Recommendation IDs from the last response, used for deduplication',
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
    const recommendations =
      this.todayRecommendationsService.getRandomRecommendations(
        normalizedExclude,
        lang,
      );
    return successEnvelope(recommendations);
  }

  @SkipThrottle()
  @Post('generate/stream')
  @SkipApiEnvelope()
  @ApiOperation({
    summary: 'Stream authenticated user today AI analysis generation',
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
  async generateStream(
    @CurrentUser() user: UserPayload,
    @Body() dto: GenerateTodayAnalysisDto,
    @I18nLang() language: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    prepareSse(reply.raw, this.sseRegistry);

    try {
      const result = await this.todayAnalysisService.generateStream(
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
        `Today analysis stream failed for user ${user.sub}: ${reason}`,
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
}

function httpExceptionPayload(error: unknown): {
  message: string;
  code?: number;
  statusCode?: number;
} {
  if (!(error instanceof HttpException)) {
    return {
      message: error instanceof Error ? error.message : 'Unexpected error.',
    };
  }

  const response = error.getResponse();
  if (typeof response === 'string') {
    return withOptionalErrorFields(response, undefined, error.getStatus());
  }

  const message =
    'message' in response
      ? (response as { message?: unknown }).message
      : undefined;
  const code =
    'code' in response ? (response as { code?: unknown }).code : undefined;
  if (Array.isArray(message)) {
    return withOptionalErrorFields(
      message.join('; '),
      typeof code === 'number' ? code : undefined,
      error.getStatus(),
    );
  }
  if (typeof message === 'string' && message.trim().length > 0) {
    return withOptionalErrorFields(
      message,
      typeof code === 'number' ? code : undefined,
      error.getStatus(),
    );
  }
  return withOptionalErrorFields(
    error.message,
    typeof code === 'number' ? code : undefined,
    error.getStatus(),
  );
}

function withOptionalErrorFields(
  message: string,
  code?: number,
  statusCode?: number,
): { message: string; code?: number; statusCode?: number } {
  const payload: { message: string; code?: number; statusCode?: number } = {
    message,
  };
  if (code != null) {
    payload.code = code;
  }
  if (statusCode != null) {
    payload.statusCode = statusCode;
  }
  return payload;
}
