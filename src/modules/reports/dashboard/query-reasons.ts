/**
 * Log-only reasons for a rejected report dashboard query.
 *
 * Not wire content: `ProblemCatalog.build` resolves `detail` as
 * `options.detail ?? translate(key)`, so an explicit sentence overrides the
 * registry's translated copy. These were English sentences, which meant every
 * locale got English instead of the registered bilingual detail.
 */
export const REPORT_QUERY_REASON = {
  CUSTOM_RANGE_END_REQUIRED: 'custom_range_end_required',
  CUSTOM_RANGE_END_IN_FUTURE: 'custom_range_end_in_future',
  CUSTOM_RANGE_START_REQUIRED: 'custom_range_start_required',
  CUSTOM_RANGE_START_AFTER_END: 'custom_range_start_after_end',
} as const;

export type ReportQueryReason =
  (typeof REPORT_QUERY_REASON)[keyof typeof REPORT_QUERY_REASON];
