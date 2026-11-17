/**
 * Outbound port: prove a health event exists, belongs to the user, and is active.
 *
 * ## Why a port and not a direct import of `HealthEventsOwnershipService`
 *
 * The events module is a different context. Depending on its service class
 * couples this context's application layer to another module's implementation —
 * exactly what ADR-0024's cross-context rules forbid outside the barrel. A port
 * lets the adapter call whatever the owning context exposes and keeps the failure
 * contract explicit here.
 *
 * ## Failure shape
 *
 * The owning service throws (its `DomainFailure` surfaces as an exception through
 * the global filter). The adapter preserves that: a rejection is passed through
 * untouched, so the 404/403 the events context decided is not rewritten here.
 */

import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';

export abstract class HealthEventGuard {
  /**
   * Resolves when the event exists, is owned by `userId`, and is active;
   * otherwise fails with the events context's own failure.
   */
  abstract ensureActiveOwnedByUser(
    userId: string,
    healthEventId: string,
  ): ResultAsync<void, DomainFailure>;
}
