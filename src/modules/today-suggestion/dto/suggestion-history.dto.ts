import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SuggestionItemDto } from './suggestion-response.dto';
import type { MaterializationStatus } from '../types/materialization.types';

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

  @ApiProperty({
    enum: ['empty', 'pending', 'ready', 'stale', 'failed'],
    description: 'Current background materialization state',
  })
  materializationStatus!: MaterializationStatus;

  @ApiProperty({ description: 'Latest source version observed for this date' })
  sourceVersion!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'When the last successful materialization completed',
  })
  computedAt!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Suggested client polling delay in seconds',
  })
  retryAfterSeconds!: number | null;
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
