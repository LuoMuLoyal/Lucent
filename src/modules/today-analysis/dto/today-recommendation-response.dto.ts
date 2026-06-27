import { ApiProperty } from '@nestjs/swagger';

export class TodayRecommendationResponseDto {
  @ApiProperty({ description: 'Unique recommendation id' })
  id!: string;

  @ApiProperty({ description: 'Recommendation text' })
  text!: string;

  @ApiProperty({ description: 'Recommendation category', required: false })
  category?: string;
}
