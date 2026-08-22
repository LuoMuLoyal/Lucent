import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Data payload for POST /today/suggestions/:id/explain. */
export class SuggestionExplanationDataDto {
  @ApiProperty({ description: 'The suggestion ID that was explained' })
  suggestionId!: string;

  @ApiProperty({
    description: 'AI-enhanced or original reason text',
  })
  reason!: string;

  @ApiProperty({
    description: 'AI-enhanced or original boundary / disclaimer text',
  })
  boundary!: string;

  @ApiProperty({
    description: 'Whether the AI model was used to generate the explanation',
  })
  aiGenerated!: boolean;

  @ApiPropertyOptional({
    description: 'Locale used for the explanation (e.g. "zh-CN", "en")',
  })
  locale?: string;
}

/** Envelope response for POST /today/suggestions/:id/explain. */
export class SuggestionExplanationResponseDto extends SuggestionExplanationDataDto {}
