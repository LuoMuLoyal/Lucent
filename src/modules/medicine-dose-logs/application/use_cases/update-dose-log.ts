/**
 * Use case: `PATCH /api/v1/user/medicine-dose-logs/:id`.
 *
 * Ownership first, then a partial write: only supplied keys become columns
 * (omitting `doseText` must not clear it, while sending `null` must). A status
 * change also re-derives `takenAt`, so the column keeps meaning "when it was
 * actually taken" rather than drifting.
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
import { takenAtFor } from '../../domain/dose-log/dose-log.js';
import type { DoseLogs } from '../../domain/dose-log/dose-logs.js';
import type { DoseLogPatch } from '../../domain/dose-log/dose-logs.js';
import type { DoseLogEvents } from '../ports/dose-log-events.js';
import type { UpdateDoseLogCommand } from '../ports/dose-log-resource.js';
import type { DoseLogResource } from '../ports/dose-log-resource.js';
import { toDoseLogResource } from '../read_models/dose-log.js';
import { notFound } from './failures.js';

export class UpdateDoseLog {
  constructor(
    private readonly repository: DoseLogs,
    private readonly events: DoseLogEvents,
  ) {}

  execute(
    userId: string,
    id: string,
    command: UpdateDoseLogCommand,
  ): ResultAsync<DoseLogResource, DomainFailure> {
    return fromPromise(
      this.run(userId, id, command),
      (error) => error as DomainFailure,
    );
  }

  private async run(
    userId: string,
    id: string,
    command: UpdateDoseLogCommand,
  ): Promise<DoseLogResource> {
    const owned = await this.repository.findOwned(userId, id);
    if (owned === null) {
      notFound();
    }

    const patch: DoseLogPatch = {};
    if (command.status !== undefined) {
      patch.status = command.status;
      patch.takenAt = takenAtFor(
        command.status === 'taken' ? 'taken' : 'skipped',
        now(),
      );
    }
    if (command.doseText !== undefined) {
      patch.doseText = command.doseText;
    }
    if (command.note !== undefined) {
      patch.note = command.note;
    }

    const record = await this.repository.update(id, patch);
    await this.events.doseLogChanged({
      userId,
      date: formatDateOnly(owned.scheduledFor),
      doseLogId: id,
    });
    return toDoseLogResource(record);
  }
}
