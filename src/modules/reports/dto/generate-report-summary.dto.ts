import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, ValidateIf } from 'class-validator';
import {
  REPORT_RANGE_CUSTOM,
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

  @ApiPropertyOptional({
    description:
      'Required when range is "custom". ISO 8601 date string (YYYY-MM-DD).',
  })
  @ValidateIf((o: GenerateReportSummaryDto) => o.range === REPORT_RANGE_CUSTOM)
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description:
      'Required when range is "custom". ISO 8601 date string (YYYY-MM-DD).',
  })
  @ValidateIf((o: GenerateReportSummaryDto) => o.range === REPORT_RANGE_CUSTOM)
  @IsDateString()
  endDate?: string;
}
