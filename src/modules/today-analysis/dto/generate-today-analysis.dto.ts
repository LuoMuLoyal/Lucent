import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class GenerateTodayAnalysisDto {
  @ApiPropertyOptional({
    description:
      'Target date in YYYY-MM-DD format. Defaults to backend current day when omitted.',
    example: '2026-06-12',
  })
  @IsOptional()
  @IsDateString()
  date?: string;
}
