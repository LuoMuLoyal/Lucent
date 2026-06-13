import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
  REPORT_SUPPORTED_RANGES,
  type ReportRange,
} from './report-dashboard-query.dto';

export class GenerateReportSummaryDto {
  @ApiPropertyOptional({
    enum: REPORT_SUPPORTED_RANGES,
    description: 'Supported report summary aggregation range.',
  })
  @IsOptional()
  @IsIn(REPORT_SUPPORTED_RANGES)
  range?: ReportRange;
}
