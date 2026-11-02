import { Injectable } from '@nestjs/common';

/**
 * Use case: `DELETE /api/v1/user/medicine-dose-logs/:id`.
 *
 * Soft delete only: the row keeps existing with `deletedAt` stamped, so the slot
 * can be re-marked as a *new* row later (see `MarkDoseLog`) and history is not
 * destroyed. The event is announced before the write so a consumer that reacts by
 * re-reading cannot observe the pre-delete state from a warm cache.
 */

import {
  fromPromise,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import {
  formatDateOnly,
  now,
} from '../../../../common/helpers/format/date-time.utils.js';
import { DoseLogs } from '../../domain/dose-log/dose-logs.js';
import { DoseLogEvents } from '../ports/dose-log-events.js';
import { mapUnknownToInternalFailure } from '../../../../common/result/unknown-error.mapper.js';
import { notFound } from './failures.js';

/** `@Injectable()` is required for Nest to read this class's constructor metadata. */
@Injectable()
export class DeleteDoseLog {
  constructor(
    private readonly repository: DoseLogs,
    private readonly events: DoseLogEvents,
  ) {}

  execute(userId: string, id: string): ResultAsync<void, DomainFailure> {
    // Not `(error) => error as DomainFailure`: a non-domain rejection (a Prisma
    // failure, say) would reach `unwrapResult` with no `code`, and the exception
    // filter would turn a 404 into a 500 ("Unknown Problem Details code: undefined").
    return fromPromise(this.run(userId, id), (error) =>
      mapUnknownToInternalFailure(error),
    );
  }

  private async run(userId: string, id: string): Promise<void> {
    const owned = await this.repository.findOwned(userId, id);
    if (owned === null) {
      notFound();
    }

    await this.events.doseLogChanged({
      userId,
      date: formatDateOnly(owned.scheduledFor),
      doseLogId: id,
    });
    await this.repository.softDelete(id, now());
  }
}
