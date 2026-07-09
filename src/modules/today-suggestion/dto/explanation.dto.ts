import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Response DTO for the AI explanation endpoint. */
export class SuggestionExplanationResponseDto {
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
