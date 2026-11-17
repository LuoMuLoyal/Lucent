/** Whether a metric has a trustworthy observed value. */
export type ObservedMetricState = 'observed' | 'unknown';

/** How much of the metric's expected window is covered by observations. */
export type ObservedMetricCoverage = 'sufficient' | 'partial' | 'none';

/** Stable provenance categories exposed by metric consumers. */
export type ObservedMetricSource =
  | 'manual'
  | 'health_platform'
  | 'reminder_plan'
  | 'derived';

/**
 * Shared value contract for sparse health observations.
 *
 * `value: null` plus `state: 'unknown'` means that no trustworthy value is
 * available. A real zero is represented by `value: 0` and `state: 'observed'`.
 */
export interface ObservedMetric<T> {
  value: T | null;
  state: ObservedMetricState;
  coverage: ObservedMetricCoverage;
  sources: ObservedMetricSource[];
  observedCount: number;
  expectedCount: number | null;
  windowStart: string;
  windowEnd: string;
}
