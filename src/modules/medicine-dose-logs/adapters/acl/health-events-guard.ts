/**
 * ACL adapter: `HealthEventGuard` over the health-events context.
 *
 * The owning service keeps a throwing Promise-style contract, so this adapter
 * mirrors it: a rejection is passed through untouched, which preserves the
 * 404/403 the events context already decided. Re-deriving a failure here would
 * either duplicate or contradict that decision.
 */

import { Injectable } from '@nestjs/common';

import { fromPromise } from '../../../../common/result/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import { HealthEventsOwnershipService } from '../../../health-events/index.js';
import { HealthEventGuard } from '../../application/ports/health-event-guard.js';

@Injectable()
export class HealthEventsGuardAdapter extends HealthEventGuard {
  constructor(private readonly ownership: HealthEventsOwnershipService) {
    super();
  }

  ensureActiveOwnedByUser(
    userId: string,
    healthEventId: string,
  ): ResultAsync<void, DomainFailure> {
    return fromPromise(
      this.ownership.ensureActiveOwnedByUser(userId, healthEventId),
      (error) => {
        // Preserve the events context's failure verbatim.
        throw error;
      },
    ).map(() => undefined);
  }
}
