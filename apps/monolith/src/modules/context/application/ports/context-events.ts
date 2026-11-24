/**
 * Outbound port: announce `context.changed` after a successful write.
 *
 * `suggestion` and `assistant` drop derived state on this event. Best
 * effort: the write is already persisted, so a dropped publish only leaves stale
 * derived data until the next recompute. The adapter logs.
 */

import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';

export abstract class ContextEvents {
  abstract contextChanged(
    userId: string,
  ): ResultAsync<void, DomainFailure>;
}
