/**
 * Job names of the fan-out consumers (ADR-0025).
 *
 * A fanned-out job's name must equal the name the owning module's worker
 * dispatches on — otherwise the fan-out enqueues a job nobody claims and it
 * sits in Redis until retention drops it. Keeping the names here means
 * `subscriptions.ts` (pure data) and the owning module import the same
 * constant instead of duplicating a string literal.
 *
 * A constant is added here **together with the consumer that awaits it**, so
 * the table can never name a job no worker handles. `subscriptions.spec.ts`
 * asserts every table row references one of these values.
 */

/** `reports`: drop the reports dashboard cache for the event's user. */
export const REPORT_CACHE_INVALIDATION_JOB = 'invalidate';

/** Every declared job name, for the subscription-table drift guard. */
export const EVENT_JOB_NAMES: readonly string[] = [
  REPORT_CACHE_INVALIDATION_JOB,
];
