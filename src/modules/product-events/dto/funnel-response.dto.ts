import { z } from 'zod';

/**
 * Product funnel aggregation response schemas.
 *
 * One UTC calendar day of CORE funnel counts (plan: event started →
 * suggestion impression/actioned → event ended/outcome → review opened).
 *
 * Counts only — the funnel response carries NO health content, rule codes,
 * user ids, device ids or free text of any kind: every field is a number or
 * a date key, and the schema surface is the only thing the controller can
 * return (no map/JSON column exists anywhere in the response path).
 *
 * Each schema replaces the former `@ApiProperty` response class of the same
 * name (minus the `Schema` suffix).
 */

/** Replaces `FunnelDailyCountsDto`. */
export const funnelDailyCountsSchema = z.object({
  date: z.string().describe('UTC calendar day (YYYY-MM-DD).'),
  eventStarted: z.number().describe('health_event_started count.'),
  suggestionImpression: z.number().describe('suggestion_impression count.'),
  suggestionActioned: z.number().describe('suggestion_actioned count.'),
  eventEndedOrOutcome: z
    .number()
    .describe(
      'health_event_ended + health_event_outcome_confirmed count — the ended/outcome stage (both names are the same user-visible step).',
    ),
  reviewOpened: z.number().describe('review_opened count.'),
});

/** Strongly typed per-UTC-day core funnel counts. */
export type FunnelDailyCountsDto = z.infer<typeof funnelDailyCountsSchema>;

/**
 * Window totals of the OPTIONAL visit-summary events. Deliberately separate
 * from the core funnel: preview/export/share/open are never core success
 * criteria (plan: 导出与分享不反向阻塞核心闭环).
 *
 * Replaces `FunnelOptionalCountsDto`.
 */
export const funnelOptionalCountsSchema = z.object({
  visitSummaryPreviewed: z.number().describe('visit_summary_previewed count.'),
  visitSummaryExported: z.number().describe('visit_summary_exported count.'),
  visitSummaryShareCreated: z
    .number()
    .describe('visit_summary_share_created count.'),
  visitSummaryShareOpened: z
    .number()
    .describe('visit_summary_share_opened count.'),
});

/** Strongly typed window totals of the optional visit-summary events. */
export type FunnelOptionalCountsDto = z.infer<
  typeof funnelOptionalCountsSchema
>;

/**
 * Window totals with the same breakdown as the daily rows (core funnel only).
 * Always returned — even when per-day details are suppressed.
 *
 * Replaces `FunnelTotalsDto`.
 */
export const funnelTotalsSchema = z.object({
  eventStarted: z.number().describe('health_event_started count.'),
  suggestionImpression: z.number().describe('suggestion_impression count.'),
  suggestionActioned: z.number().describe('suggestion_actioned count.'),
  eventEndedOrOutcome: z.number().describe('ended/outcome stage count.'),
  reviewOpened: z.number().describe('review_opened count.'),
});

/** Strongly typed window totals of the core funnel. */
export type FunnelTotalsDto = z.infer<typeof funnelTotalsSchema>;

/** Window metadata echoed back to the caller. Replaces `FunnelWindowDto`. */
export const funnelWindowSchema = z.object({
  dateFrom: z
    .string()
    .describe('Window start (inclusive), UTC calendar day (YYYY-MM-DD).'),
  dateTo: z
    .string()
    .describe('Window end (inclusive), UTC calendar day (YYYY-MM-DD).'),
  generatedAt: z.string().describe('Response generation time (ISO 8601).'),
  detailsSuppressed: z
    .boolean()
    .describe(
      'True when the window core-funnel total is below the fixed small-sample threshold — per-day group details are suppressed (daily is empty), window totals are still returned so the admin UI knows the sample is too small to break down.',
    ),
});

/** Strongly typed funnel window metadata. */
export type FunnelWindowDto = z.infer<typeof funnelWindowSchema>;

/**
 * Full funnel aggregation payload (admin endpoint). Replaces
 * `FunnelDataDto`.
 */
export const funnelDataSchema = z.object({
  daily: z
    .array(funnelDailyCountsSchema)
    .describe(
      'Per-UTC-day core funnel counts, ascending by date; empty when detailsSuppressed is true.',
    ),
  optional: funnelOptionalCountsSchema.describe(
    'Window totals of the optional visit-summary events.',
  ),
  totals: funnelTotalsSchema.describe(
    'Window totals of the core funnel (same breakdown as daily).',
  ),
  window: funnelWindowSchema,
});

/** Strongly typed full funnel aggregation payload. */
export type FunnelDataDto = z.infer<typeof funnelDataSchema>;

/**
 * Response schema of `GET /product-events/funnel` — wire-identical to
 * {@link funnelDataSchema}. Replaces the former response class
 * `FunnelResponseDto` (which extended `FunnelDataDto` without adding fields).
 */
export const funnelResponseSchema = funnelDataSchema;

/** Strongly typed full funnel aggregation response body. */
export type FunnelResponseDto = z.infer<typeof funnelResponseSchema>;
