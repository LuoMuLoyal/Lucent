/**
 * Diagnostics for the clinic-summary validation failures.
 *
 * These are **log-only** labels, not wire content.
 *
 * `ProblemCatalog.build` resolves `detail` as `options.detail ?? translate(key)`,
 * so any explicit `detail` overrides the registry's bilingual copy: these flows
 * used to pass Chinese sentences, and an English client received a Chinese
 * sentence instead of the registered English detail — the reason ADR-0012's
 * registry exists.
 *
 * The fix is therefore to omit `detail` on the wire and let the registry speak.
 * These constants keep the "which rule failed" signal for logs and tests, with
 * the variable parts as typed args rather than interpolated prose.
 */
export const CLINIC_SUMMARY_REASON = {
  SELECTED_FIELDS_REQUIRED: 'selected_fields_required',
  UNSUPPORTED_SHARE_FIELD: 'unsupported_share_field',
  UNSUPPORTED_SUMMARY_RANGE: 'unsupported_summary_range',
  SCOPE_CONFLICT: 'scope_conflict',
  SCOPE_REQUIRED: 'scope_required',
  DATE_RANGE_INCOMPLETE: 'date_range_incomplete',
  INVALID_DATE: 'invalid_date',
  DATE_RANGE_INVERTED: 'date_range_inverted',
  DATE_RANGE_TOO_LONG: 'date_range_too_long',
  EVENT_SCOPE_UNAVAILABLE: 'event_scope_unavailable',
} as const;

export type ClinicSummaryReason =
  (typeof CLINIC_SUMMARY_REASON)[keyof typeof CLINIC_SUMMARY_REASON];
