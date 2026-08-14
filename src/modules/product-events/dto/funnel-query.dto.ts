import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

/**
 * Max INCLUSIVE UTC calendar days for one funnel query window
 * (dateFrom..dateTo). Mirrors the existing product cap
 * `CLINIC_SUMMARY_MAX_RANGE_DAYS` and the legacy last_30_days report range:
 * dateFrom == dateTo is a valid single-day window; a span of 31 inclusive
 * days is rejected with 400 by the service.
 */
export const MAX_FUNNEL_RANGE_DAYS = 30;

/**
 * Query params for the admin funnel aggregation endpoint. Both dates are
 * optional together: when neither is given the service falls back to the
 * default window (last `DEFAULT_FUNNEL_WINDOW_DAYS` days ending today, UTC).
 */
export class FunnelQueryDto {
  @ApiPropertyOptional({
    description:
      'Window start (inclusive), ISO 8601 date (YYYY-MM-DD) or datetime; the UTC calendar day is used.',
    example: '2026-07-16',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description:
      'Window end (inclusive), ISO 8601 date (YYYY-MM-DD) or datetime; the UTC calendar day is used.',
    example: '2026-08-14',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
