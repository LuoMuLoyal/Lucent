import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, ValidateIf } from 'class-validator';

export const REPORT_RANGE_LAST_7_DAYS = 'last_7_days';
export const REPORT_RANGE_LAST_30_DAYS = 'last_30_days';
export const REPORT_RANGE_CUSTOM = 'custom';
export const REPORT_SUPPORTED_RANGES = [
  REPORT_RANGE_LAST_7_DAYS,
  REPORT_RANGE_LAST_30_DAYS,
  REPORT_RANGE_CUSTOM,
] as const;

export type ReportRange = (typeof REPORT_SUPPORTED_RANGES)[number];

export class ReportDashboardQueryDto {
  @ApiPropertyOptional({
    enum: REPORT_SUPPORTED_RANGES,
    default: REPORT_RANGE_LAST_7_DAYS,
    description: 'Supported report aggregation range.',
  })
  @IsOptional()
  @IsIn(REPORT_SUPPORTED_RANGES)
  range?: ReportRange = REPORT_RANGE_LAST_7_DAYS;

  @ApiPropertyOptional({
    description:
      'Required when range is "custom". ISO 8601 date string (YYYY-MM-DD).',
  })
  @ValidateIf((o: ReportDashboardQueryDto) => o.range === REPORT_RANGE_CUSTOM)
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description:
      'Required when range is "custom". ISO 8601 date string (YYYY-MM-DD).',
  })
  @ValidateIf((o: ReportDashboardQueryDto) => o.range === REPORT_RANGE_CUSTOM)
  @IsDateString()
  endDate?: string;
}
