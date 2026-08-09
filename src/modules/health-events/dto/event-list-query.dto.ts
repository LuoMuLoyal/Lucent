import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, Matches } from 'class-validator';

export class EventListQueryDto {
  @ApiPropertyOptional({
    description:
      'Calendar date used to select the check-in in YYYY-MM-DD format.',
    example: '2026-08-09',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}
