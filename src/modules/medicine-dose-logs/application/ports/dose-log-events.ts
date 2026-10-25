/**
 * Outbound port: publish `dose-log.changed` after a write.
 *
 * `today-suggestion` and `today-analysis` drop derived caches on this event, so a
 * dropped publish leaves a stale suggestion until the next recompute. That is a
 * degraded outcome, not a failed write: the dose log **is** persisted. The
 * adapter logs and swallows, matching the previous best-effort behaviour.
 */

import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';

export abstract class DoseLogEvents {
  /**
   * Announces that the user's logs for `date` changed.
   *
   * `doseLogId` is present when a single identifiable row was written; consumers
   * treating its absence mean "assume any log for that date may have moved".
   */
  abstract doseLogChanged(input: {
    userId: string;
    date: string;
    doseLogId?: string;
  }): ResultAsync<void, DomainFailure>;
}
