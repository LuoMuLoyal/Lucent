import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
import type { TodaySuggestionsResponseDto } from './dto';

@ApiTags('Today Suggestion')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('today/suggestions')
export class TodaySuggestionController {
  constructor(private readonly suggestionService: SuggestionService) {}

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
}
