/**
 * Outbound port: announce `health-context.changed` after a successful write.
 *
 * `today-suggestion` and `assistant` drop derived state on this event. Best
 * effort: the write is already persisted, so a dropped publish only leaves stale
 * derived data until the next recompute. The adapter logs.
 */

import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';

export abstract class HealthContextEvents {
  abstract healthContextChanged(
    userId: string,
  ): ResultAsync<void, DomainFailure>;
}
