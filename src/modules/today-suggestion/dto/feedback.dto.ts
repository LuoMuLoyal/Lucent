import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class SuggestionFeedbackDto {
  @ApiProperty({
    description: 'User feedback for the suggestion',
    enum: ['accepted', 'later', 'not_applicable', 'suppress'],
  })
  @IsIn(['accepted', 'later', 'not_applicable', 'suppress'])
  feedback!: 'accepted' | 'later' | 'not_applicable' | 'suppress';
}

export class SuggestionFeedbackResponseDto {
  @ApiProperty()
  suggestionId!: string;

  @ApiProperty()
  feedback!: string;

  @ApiProperty({ description: 'Effect applied by the feedback engine' })
  appliedEffect!: string;

  @ApiPropertyOptional({
    description: 'When the suppression expires (if applicable)',
  })
  expiresAt?: string;
}
