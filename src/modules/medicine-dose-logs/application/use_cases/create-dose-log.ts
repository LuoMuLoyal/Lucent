import { Injectable } from '@nestjs/common';

/**
 * Use case: `POST /api/v1/user/medicine-dose-logs`.
 *
 * Resolve the target, insert, announce, then render. `create` always inserts —
 * two identical payloads produce two rows, because a "create" is an assertion
 * that this dose happened, not an upsert. Callers that want slot idempotency use
 * `mark` instead.
 */

import {
  fromPromise,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import { mapUnknownToInternalFailure } from '../../../../common/result/unknown-error.mapper.js';
import { formatDateOnly } from '../../../../common/helpers/format/date-time.utils.js';
import { now } from '../../../../common/helpers/format/date-time.utils.js';
import { parseDateOnly } from '../../../../common/helpers/format/date-time.utils.js';
import { takenAtFor } from '../../domain/dose-log/dose-log.js';
import { DoseLogs } from '../../domain/dose-log/dose-logs.js';
import { DoseLogEvents } from '../ports/dose-log-events.js';
import type { CreateDoseLogCommand } from '../ports/dose-log-resource.js';
import type { DoseLogResource } from '../ports/dose-log-resource.js';
import { toDoseLogResource } from '../read_models/dose-log.js';
import { DoseTargetResolver } from './dose-target-resolver.js';

/** `@Injectable()` is required for Nest to read this class's constructor metadata. */
@Injectable()
export class CreateDoseLog {
  constructor(
    private readonly repository: DoseLogs,
    private readonly resolver: DoseTargetResolver,
    private readonly events: DoseLogEvents,
  ) {}

  execute(
    userId: string,
    command: CreateDoseLogCommand,
  ): ResultAsync<DoseLogResource, DomainFailure> {
    return fromPromise(this.run(userId, command), (error) =>
      mapUnknownToInternalFailure(error),
    );
  }

  private async run(
    userId: string,
    command: CreateDoseLogCommand,
  ): Promise<DoseLogResource> {
    const target = await this.resolver.resolve(
      userId,
      {
        reminderId: command.reminderId,
        currentMedicineId: command.currentMedicineId,
        scheduledFor: parseDateOnly(command.scheduledFor),
        scheduledTime: command.scheduledTime,
      },
      command.healthEventId,
    );

    const at = now();
    const record = await this.repository.create({
      userId,
      healthEventId: command.healthEventId ?? null,
      currentMedicineId: target.currentMedicineId,
      reminderId: target.reminderId,
      status: command.status,
      scheduledFor: target.scheduledFor,
      scheduledTime: target.scheduledTime,
      takenAt: takenAtFor(command.status === 'taken' ? 'taken' : 'skipped', at),
      doseText: command.doseText ?? null,
      note: command.note ?? null,
    });

    await this.events.doseLogChanged({
      userId,
      date: formatDateOnly(target.scheduledFor),
      doseLogId: record.id,
    });

    return toDoseLogResource(record);
  }
}
