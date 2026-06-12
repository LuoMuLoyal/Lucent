import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const REPORT_RANGE_LAST_7_DAYS = 'last_7_days';
export const REPORT_SUPPORTED_RANGES = [REPORT_RANGE_LAST_7_DAYS] as const;

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
}
