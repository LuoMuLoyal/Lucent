/**
 * Report range vocabulary.
 *
 * This lives in the application layer, not in the HTTP DTO: the range is a
 * product decision ("which windows can a user ask for"), and both the read
 * model and the use case branch on it. The DTO re-exports it so the public
 * import path does not change for consumers.
 */

/** The seven-day default window. */
export const REPORT_RANGE_LAST_7_DAYS = 'last_7_days';

/** The thirty-day window. */
export const REPORT_RANGE_LAST_30_DAYS = 'last_30_days';

/** An explicit `startDate`/`endDate` pair. */
export const REPORT_RANGE_CUSTOM = 'custom';

/** Every range a client may request. */
export const REPORT_SUPPORTED_RANGES = [
  REPORT_RANGE_LAST_7_DAYS,
  REPORT_RANGE_LAST_30_DAYS,
  REPORT_RANGE_CUSTOM,
] as const;

/** One supported report aggregation window. */
export type ReportRange = (typeof REPORT_SUPPORTED_RANGES)[number];
