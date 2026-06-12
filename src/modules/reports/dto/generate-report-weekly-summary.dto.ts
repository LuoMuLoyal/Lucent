import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
  REPORT_SUPPORTED_RANGES,
  type ReportRange,
} from './report-dashboard-query.dto';

export class GenerateReportWeeklySummaryDto {
  @ApiPropertyOptional({
    enum: REPORT_SUPPORTED_RANGES,
    description: 'Supported weekly summary aggregation range.',
  })
  @IsOptional()
  @IsIn(REPORT_SUPPORTED_RANGES)
  range?: ReportRange;
}
