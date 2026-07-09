import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { successEnvelope } from '../../common/api';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { UserPayload } from '../auth/types/auth-request';
import { SuggestionService } from './services/suggestion.service';
import { FeedbackService } from './services/feedback/feedback.service';
import type { TodaySuggestionsResponseDto } from './dto';
import { SuggestionFeedbackDto, SuggestionFeedbackResponseDto } from './dto';

@ApiTags('Today Suggestion')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('today/suggestions')
export class TodaySuggestionController {
  constructor(
    private readonly suggestionService: SuggestionService,
    private readonly feedbackService: FeedbackService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get Today page suggestion cards' })
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
  ) {
    const normalizedExclude = Array.isArray(excludeIds)
      ? excludeIds
      : excludeIds
        ? [excludeIds]
        : [];

    const result: TodaySuggestionsResponseDto =
      await this.suggestionService.generate(user.sub, date, normalizedExclude);

    return successEnvelope(result);
  }

  @Post(':id/feedback')
  @ApiOperation({ summary: 'Submit feedback for a suggestion card' })
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

    const response: SuggestionFeedbackResponseDto = {
      suggestionId: result.suggestionId,
      feedback: result.feedback,
      appliedEffect: result.appliedEffect,
      ...(result.expiresAt != null ? { expiresAt: result.expiresAt } : {}),
    };

    return successEnvelope(response);
  }
}
