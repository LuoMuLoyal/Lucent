import { ApiProperty } from '@nestjs/swagger';

/**
 * One UTC calendar day of CORE funnel counts (plan: event started →
 * suggestion impression/actioned → event ended/outcome → review opened).
 *
 * Counts only — the funnel response carries NO health content, rule codes,
 * user ids, device ids or free text of any kind: every field is a number or
 * a date key, and the DTO surface is the only thing the controller can
 * return (no map/JSON column exists anywhere in the response path).
 */
export class FunnelDailyCountsDto {
  @ApiProperty({
    description: 'UTC calendar day (YYYY-MM-DD).',
    example: '2026-08-14',
  })
  date!: string;

  @ApiProperty({
    description: 'health_event_started count.',
    example: 12,
  })
  eventStarted!: number;

  @ApiProperty({
    description: 'suggestion_impression count.',
    example: 9,
  })
  suggestionImpression!: number;

  @ApiProperty({
    description: 'suggestion_actioned count.',
    example: 4,
  })
  suggestionActioned!: number;

  @ApiProperty({
    description:
      'health_event_ended + health_event_outcome_confirmed count — the ended/outcome stage (both names are the same user-visible step).',
    example: 3,
  })
  eventEndedOrOutcome!: number;

  @ApiProperty({
    description: 'review_opened count.',
    example: 5,
  })
  reviewOpened!: number;
}

/**
 * Window totals of the OPTIONAL visit-summary events. Deliberately separate
 * from the core funnel: preview/export/share/open are never core success
 * criteria (plan: 导出与分享不反向阻塞核心闭环).
 */
export class FunnelOptionalCountsDto {
  @ApiProperty({ description: 'visit_summary_previewed count.', example: 2 })
  visitSummaryPreviewed!: number;

  @ApiProperty({ description: 'visit_summary_exported count.', example: 1 })
  visitSummaryExported!: number;

  @ApiProperty({
    description: 'visit_summary_share_created count.',
    example: 1,
  })
  visitSummaryShareCreated!: number;

  @ApiProperty({ description: 'visit_summary_share_opened count.', example: 1 })
  visitSummaryShareOpened!: number;
}

/**
 * Window totals with the same breakdown as the daily rows (core funnel only).
 * Always returned — even when per-day details are suppressed.
 */
export class FunnelTotalsDto {
  @ApiProperty({ description: 'health_event_started count.', example: 42 })
  eventStarted!: number;

  @ApiProperty({ description: 'suggestion_impression count.', example: 31 })
  suggestionImpression!: number;

  @ApiProperty({ description: 'suggestion_actioned count.', example: 12 })
  suggestionActioned!: number;

  @ApiProperty({ description: 'ended/outcome stage count.', example: 9 })
  eventEndedOrOutcome!: number;

  @ApiProperty({ description: 'review_opened count.', example: 14 })
  reviewOpened!: number;
}

/** Window metadata echoed back to the caller. */
export class FunnelWindowDto {
  @ApiProperty({
    description: 'Window start (inclusive), UTC calendar day (YYYY-MM-DD).',
    example: '2026-07-16',
  })
  dateFrom!: string;

  @ApiProperty({
    description: 'Window end (inclusive), UTC calendar day (YYYY-MM-DD).',
    example: '2026-08-14',
  })
  dateTo!: string;

  @ApiProperty({
    description: 'Response generation time (ISO 8601).',
    example: '2026-08-14T02:00:00.000Z',
  })
  generatedAt!: string;

  @ApiProperty({
    description:
      'True when the window core-funnel total is below the fixed small-sample threshold — per-day group details are suppressed (daily is empty), window totals are still returned so the admin UI knows the sample is too small to break down.',
    example: true,
  })
  detailsSuppressed!: boolean;
}

/** Full funnel aggregation response (admin endpoint). */
export class FunnelResponseDto {
  @ApiProperty({
    type: FunnelDailyCountsDto,
    isArray: true,
    description:
      'Per-UTC-day core funnel counts, ascending by date; empty when detailsSuppressed is true.',
  })
  daily!: FunnelDailyCountsDto[];

  @ApiProperty({
    type: FunnelOptionalCountsDto,
    description: 'Window totals of the optional visit-summary events.',
  })
  optional!: FunnelOptionalCountsDto;

  @ApiProperty({
    type: FunnelTotalsDto,
    description: 'Window totals of the core funnel (same breakdown as daily).',
  })
  totals!: FunnelTotalsDto;

  @ApiProperty({ type: FunnelWindowDto })
  window!: FunnelWindowDto;
}
