import { Injectable } from '@nestjs/common';

/**
 * Use case: `POST /api/v1/user/medicine-dose-logs/mark`.
 *
 * Idempotent per slot: marking the same reminder slot twice updates the row
 * instead of inserting a second one, which is what lets the client's offline sync
 * queue retry a mark safely.
 *
 * ## What "the same slot" means
 *
 * `(reminderId, scheduledFor, scheduledTime)`, matched only against live rows.
 * Two deliberate consequences:
 *
 * - **A soft-deleted row is never resurrected.** Deleting a mistakenly-logged dose
 *   and re-marking the slot must not rewrite the deleted record, so the lookup
 *   filters deleted rows out; the mark then inserts a fresh one.
 * - **A temporary log is never merged.** With no reminder there is no stable slot
 *   identity other than the row's own id, so each mark inserts. Merging by
 *   medicine+date+time would silently collapse two separate doses of the same
 *   medicine on the same day.
 *
 * ## Health event on update
 *
 * `healthEventId` is only written when the caller supplied the key at all:
 * omitting it leaves the existing link intact, sending `null` clears it, sending
 * an id replaces it. A full-row overwrite would clear it by accident.
 */

import {
  fromPromise,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import { mapUnknownToInternalFailure } from '../../../../common/result/unknown-error.mapper.js';
import {
  formatDateOnly,
  now,
  parseDateOnly,
} from '../../../../common/helpers/format/date-time.utils.js';
import { slotIdentityOf, takenAtFor } from '../../domain/dose-log/dose-log.js';
import { DoseLogs } from '../../domain/dose-log/dose-logs.js';
import type { DoseLogPatch } from '../../domain/dose-log/dose-logs.js';
import { DoseLogEvents } from '../ports/dose-log-events.js';
import type { MarkDoseLogCommand } from '../ports/dose-log-resource.js';
import type { DoseLogResource } from '../ports/dose-log-resource.js';
import { toDoseLogResource } from '../read_models/dose-log.js';
import { unresolvedTarget } from './failures.js';
import { DoseTargetResolver } from './dose-target-resolver.js';

/** `@Injectable()` is required for Nest to read this class's constructor metadata. */
@Injectable()
export class MarkDoseLog {
  constructor(
    private readonly repository: DoseLogs,
    private readonly resolver: DoseTargetResolver,
    private readonly events: DoseLogEvents,
  ) {}

  execute(
    userId: string,
    command: MarkDoseLogCommand,
  ): ResultAsync<DoseLogResource, DomainFailure> {
    return fromPromise(
      this.run(userId, command),
      (error) => mapUnknownToInternalFailure(error),
    );
  }

  private async run(
    userId: string,
    command: MarkDoseLogCommand,
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
    const record = await this.upsert(userId, command, target, at);

    await this.events.doseLogChanged({
      userId,
      date: formatDateOnly(target.scheduledFor),
      doseLogId: record.id,
    });

    return toDoseLogResource(record);
  }

  private async upsert(
    userId: string,
    command: MarkDoseLogCommand,
    target: {
      currentMedicineId: string | null;
      reminderId: string | null;
      scheduledFor: Date;
      scheduledTime: string | null;
    },
    at: Date,
  ): Promise<Awaited<ReturnType<DoseLogs['create']>>> {
    const slot = slotIdentityOf(target);
    if (slot === null && target.currentMedicineId === null) {
      unresolvedTarget();
    }

    const existing =
      slot === null ? null : await this.repository.findBySlot(userId, slot);

    if (existing !== null) {
      const patch: DoseLogPatch = {
        status: command.status,
        currentMedicineId: target.currentMedicineId,
        reminderId: target.reminderId,
        scheduledTime: target.scheduledTime,
        takenAt: takenAtFor(
          command.status === 'taken' ? 'taken' : 'skipped',
          at,
        ),
        doseText: command.doseText ?? null,
        note: command.note ?? null,
      };
      if (command.healthEventId !== undefined) {
        patch.healthEventId = command.healthEventId;
      }
      return await this.repository.update(existing.id, patch);
    }

    return await this.repository.create({
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
  }
}
