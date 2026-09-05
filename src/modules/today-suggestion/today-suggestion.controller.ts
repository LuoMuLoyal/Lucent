import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  Query,
  Headers,
  SerializeOptions,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { formatDateOnly, now } from '../../common/index.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';
import { unwrapResult } from '../../common/result/index.js';
import { CurrentUser } from '../auth/index.js';
import type { UserPayload } from '../auth/index.js';
import { SuggestionService } from './services/suggestion.service.js';
import { FeedbackService } from './services/feedback/recorder.service.js';
import { ExplanationQueueService } from './services/explanation/queue.service.js';

import { ExplanationService } from './services/explanation/explainer.service.js';
import { LifecycleService } from './services/lifecycle/manager.service.js';
import { suggestionFeedbackSchema } from './dto/feedback.dto.js';
import {
  SuggestionFeedbackData,
  SuggestionFeedbackResponse,
} from './dto/feedback.dto.js';
import type { SuggestionFeedbackDto } from './dto/feedback.dto.js';

import { todaySuggestionsDataSchema } from './dto/suggestion-history.dto.js';
import type { TodaySuggestionsDataDto } from './dto/suggestion-history.dto.js';

import {
  suggestionExplanationAsyncResponseSchema,
  suggestionExplanationDataSchema,
} from './dto/explanation.dto.js';
import type { SuggestionExplanationDataDto } from './dto/explanation.dto.js';

import { suggestionHistoryDataSchema } from './dto/suggestion-history-query.dto.js';
import type { SuggestionHistoryDataDto } from './dto/suggestion-history-query.dto.js';

@ApiTags('Today Suggestion')
@ApiBearerAuth('access-token')
@Controller('today/suggestions')
export class TodaySuggestionController {
  constructor(
    private readonly suggestionService: SuggestionService,
    private readonly feedbackService: FeedbackService,
    private readonly explanationService: ExplanationService,
    private readonly explanationQueueService: ExplanationQueueService,
    private readonly lifecycleService: LifecycleService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get Today page suggestion cards' })
  @ApiResponse({
    status: 200,
    description: 'Today page suggestion cards with materialization state.',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'Target date (YYYY-MM-DD). Defaults to today.',
  })
  @ApiQuery({
    name: 'excludeIds',
    required: false,
    isArray: true,
    type: String,
    description: 'Suggestion IDs the user has dismissed.',
  })
  @SerializeOptions({ schema: todaySuggestionsDataSchema })
  async getSuggestions(
    @CurrentUser() user: UserPayload,
    @Query('date') date?: string,
    @Query('excludeIds') excludeIds?: string | string[],
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    const normalizedExclude = Array.isArray(excludeIds)
      ? excludeIds
      : excludeIds
        ? [excludeIds]
        : [];

    const result: TodaySuggestionsDataDto =
      await this.suggestionService.readCurrent(
        user.sub,
        date,
        normalizedExclude,
        { locale: acceptLanguage ?? 'zh-CN' },
      );

    return result;
  }

  @Post(':id/feedback')
  @ApiOperation({ summary: 'Submit feedback for a suggestion card' })
  @ApiResponse({ status: 201, type: SuggestionFeedbackResponse })
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async submitFeedback(
    @CurrentUser() user: UserPayload,
    @Param('id') suggestionId: string,
    @Body({ schema: suggestionFeedbackSchema })
    dto: SuggestionFeedbackDto,
  ) {
    const result = await unwrapResult(
      this.feedbackService.recordFeedback(user.sub, suggestionId, dto.feedback),
    );

    const response: SuggestionFeedbackData = {
      suggestionId: result.suggestionId,
      feedback: result.feedback,
      appliedEffect: result.appliedEffect,
      ...(result.expiresAt != null ? { expiresAt: result.expiresAt } : {}),
    };

    return response;
  }

  @Post(':id/explain')
  @ApiOperation({ summary: 'Get AI explanation for a suggestion card' })
  // 201 主成功体注记:export-openapi 目前只回写 200;本端点按稳定组件名登记,
  // 导出脚本支持 201 回写后自动生效。
  @ApiResponse({
    status: 201,
    description: 'The AI explanation for the suggestion card.',
  })
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @SerializeOptions({ schema: suggestionExplanationDataSchema })
  async explainSuggestion(
    @CurrentUser() user: UserPayload,
    @Param('id') suggestionId: string,
    @Headers('accept-language') language?: string,
  ) {
    const result = await unwrapResult(
      this.explanationService.explain(user.sub, suggestionId, language),
    );

    const response: SuggestionExplanationDataDto = {
      suggestionId: result.suggestionId,
      reason: result.reason,
      boundary: result.boundary,
      aiGenerated: result.aiGenerated,
    };

    return response;
  }

  @Post(':id/explain/async')
  @ApiOperation({
    summary: 'Enqueue async AI explanation for a suggestion card',
  })
  // 202 主成功体注记:export-openapi 目前只回写 200;本端点按稳定组件名登记,
  // 导出脚本支持 202 回写后自动生效。
  @ApiResponse({
    status: 202,
    description:
      'Returns either a queued jobId or the synchronous explanation resource when the queue is unavailable.',
  })
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @SerializeOptions({ schema: suggestionExplanationAsyncResponseSchema })
  async explainSuggestionAsync(
    @CurrentUser() user: UserPayload,
    @Param('id') suggestionId: string,
    @Headers('accept-language') language?: string,
  ) {
    if (this.explanationQueueService.isConfigured) {
      const jobId = await this.explanationQueueService.enqueue(
        user.sub,
        suggestionId,
        language,
      );
      if (jobId != null) {
        return { jobId };
      }
    }

    // Fallback: run synchronously when Redis is not available
    const result = await unwrapResult(
      this.explanationService.explain(user.sub, suggestionId, language),
    );
    return { result };
  }

  @SkipThrottle()
  @Get('explain/status/:jobId')
  @ApiOperation({ summary: 'Poll async suggestion explanation status' })
  @ApiResponse({
    status: 200,
    description: 'Job status (pending, completed, or failed)',
  })
  async explainSuggestionStatus(
    @CurrentUser() user: UserPayload,
    @Param('jobId') jobId: string,
  ) {
    const status = await this.explanationQueueService.getStatus(
      jobId,
      user.sub,
    );
    if (status == null) {
      return { status: 'not_found' };
    }
    return status;
  }

  @Get('history')
  @ApiOperation({ summary: 'Get suggestion history for the Report page' })
  @ApiResponse({
    status: 200,
    description: 'Suggestion history items with the query window used.',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Start date (YYYY-MM-DD). Defaults to 30 days ago.',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'End date (YYYY-MM-DD). Defaults to today.',
  })
  @ApiQuery({
    name: 'lifecycleState',
    required: false,
    enum: ['generated', 'active', 'fading', 'expired', 'dismissed'],
    description: 'Filter by lifecycle state.',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: [
      'confirmed_risk',
      'compliance',
      'trend',
      'behavior_advice',
      'coverage',
    ],
    description: 'Filter by suggestion type.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Max items (default 100, max 500).',
  })
  @SerializeOptions({ schema: suggestionHistoryDataSchema })
  async getHistory(
    @CurrentUser() user: UserPayload,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('lifecycleState') lifecycleState?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    const resolvedEndDate = endDate ?? formatDateOnly(now());
    const resolvedStartDate =
      startDate ?? LifecycleService.getDefaultStartDate();

    const parsedLimit = limit != null ? parseInt(limit, 10) : undefined;
    const validLimit =
      parsedLimit != null && !Number.isNaN(parsedLimit)
        ? parsedLimit
        : undefined;

    const result = await this.lifecycleService.getHistory(
      user.sub,
      resolvedStartDate,
      resolvedEndDate,
      acceptLanguage ?? 'zh-CN',
      {
        ...(lifecycleState != null ? { lifecycleState } : {}),
        ...(type != null ? { type } : {}),
        ...(validLimit != null ? { limit: validLimit } : {}),
      },
    );

    const response: SuggestionHistoryDataDto = {
      items: result.items,
      total: result.total,
      startDate: resolvedStartDate,
      endDate: resolvedEndDate,
    };

    return response;
  }
}

registerResponseSchema({
  path: '/api/v1/user/today/suggestions',
  method: 'get',
  componentName: 'TodaySuggestionsResponse',
  schema: todaySuggestionsDataSchema,
  description: 'Today page suggestion cards with materialization state.',
});

registerResponseSchema({
  path: '/api/v1/user/today/suggestions/history',
  method: 'get',
  componentName: 'SuggestionHistoryResponse',
  schema: suggestionHistoryDataSchema,
  description: 'Suggestion history items with the query window used.',
});

// 201/202 主成功体注记:export-openapi 目前只把注册组件的 200 响应回写为
// $ref;explain(201)与 explain/async(202)的响应体按稳定组件名登记,导出脚本
// 支持对应状态码回写后自动生效。
registerResponseSchema({
  path: '/api/v1/user/today/suggestions/{id}/explain',
  method: 'post',
  componentName: 'SuggestionExplanationResponse',
  schema: suggestionExplanationDataSchema,
  description: 'The AI explanation for the suggestion card.',
});

registerResponseSchema({
  path: '/api/v1/user/today/suggestions/{id}/explain/async',
  method: 'post',
  componentName: 'SuggestionExplanationJobResponse',
  schema: suggestionExplanationAsyncResponseSchema,
  description:
    'Returns either a queued jobId or the synchronous explanation resource when the queue is unavailable.',
});
