import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SuggestionItemDto } from './suggestion-response.dto';

/** Data payload for GET /today/suggestions. */
export class TodaySuggestionsDataDto {
  @ApiProperty({ description: 'When the suggestions were generated' })
  generatedAt!: string;

  @ApiPropertyOptional({
    type: () => SuggestionItemDto,
    description: 'Primary suggestion card (highest priority)',
  })
  primary?: SuggestionItemDto | undefined;

  @ApiPropertyOptional({
    type: () => [SuggestionItemDto],
    description: 'Secondary suggestion cards (max 2)',
  })
  secondary?: SuggestionItemDto[] | undefined;

  @ApiPropertyOptional({
    type: () => [SuggestionItemDto],
    description: 'Low-confidence observations',
  })
  observations?: SuggestionItemDto[] | undefined;

  @ApiPropertyOptional({
    description:
      'When true, one or more suggestion rules threw an error during evaluation — the returned list may be incomplete.',
  })
  degraded?: boolean | undefined;
}

/** Envelope response for GET /today/suggestions. */
export class TodaySuggestionsResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => TodaySuggestionsDataDto })
  data!: TodaySuggestionsDataDto;
}
