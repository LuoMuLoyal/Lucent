import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  Query,
  Headers,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { successEnvelope, formatDateOnly, now } from '../../common';
import { CurrentUser } from '../auth';
import type { UserPayload } from '../auth';
import { SuggestionService } from './services/suggestion.service';
import { FeedbackService } from './services/feedback/recorder.service';
import { ExplanationQueueService } from './services/explanation/queue.service';

import { ExplanationService } from './services/explanation/explainer.service';
import { LifecycleService } from './services/lifecycle/manager.service';
import {
  SuggestionFeedbackDto,
  SuggestionFeedbackDataDto,
  SuggestionFeedbackResponseDto,
} from './dto/feedback.dto';

import {
  TodaySuggestionsDataDto,
  TodaySuggestionsResponseDto,
} from './dto/suggestion-history.dto';

import {
  SuggestionExplanationDataDto,
  SuggestionExplanationResponseDto,
} from './dto/explanation.dto';

import {
  SuggestionHistoryDataDto,
  SuggestionHistoryResponseDto,
} from './dto/suggestion-history-query.dto';

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
  @ApiResponse({ status: 200, type: TodaySuggestionsResponseDto })
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

    return successEnvelope(result);
  }

  @Post(':id/feedback')
  @ApiOperation({ summary: 'Submit feedback for a suggestion card' })
  @ApiResponse({ status: 201, type: SuggestionFeedbackResponseDto })
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async submitFeedback(
    @CurrentUser() user: UserPayload,
    @Param('id') suggestionId: string,
    @Body() dto: SuggestionFeedbackDto,
  ) {
    const result = await this.feedbackService.recordFeedback(
      user.sub,
      suggestionId,
      dto.feedback,
    );

    const response: SuggestionFeedbackDataDto = {
      suggestionId: result.suggestionId,
      feedback: result.feedback,
      appliedEffect: result.appliedEffect,
      ...(result.expiresAt != null ? { expiresAt: result.expiresAt } : {}),
    };

    return successEnvelope(response);
  }

  @Post(':id/explain')
  @ApiOperation({ summary: 'Get AI explanation for a suggestion card' })
  @ApiResponse({ status: 201, type: SuggestionExplanationResponseDto })
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async explainSuggestion(
    @CurrentUser() user: UserPayload,
    @Param('id') suggestionId: string,
    @Headers('accept-language') language?: string,
  ) {
    const result = await this.explanationService.explain(
      user.sub,
      suggestionId,
      language,
    );

    const response: SuggestionExplanationDataDto = {
      suggestionId: result.suggestionId,
      reason: result.reason,
      boundary: result.boundary,
      aiGenerated: result.aiGenerated,
    };

    return successEnvelope(response);
  }

  @Post(':id/explain/async')
  @ApiOperation({
    summary: 'Enqueue async AI explanation for a suggestion card',
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
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
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
        return successEnvelope({ jobId });
      }
    }

    // Fallback: run synchronously when Redis is not available
    const result = await this.explanationService.explain(
      user.sub,
      suggestionId,
      language,
    );
    return successEnvelope({ result });
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
      return successEnvelope({ status: 'not_found' });
    }
    return successEnvelope(status);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get suggestion history for the Report page' })
  @ApiResponse({ status: 200, type: SuggestionHistoryResponseDto })
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

    return successEnvelope(response);
  }
}
