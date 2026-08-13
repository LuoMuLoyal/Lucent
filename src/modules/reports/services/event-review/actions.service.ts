import { Injectable } from '@nestjs/common';
import { DoseLogStatus, HealthEventOutcome } from '#generated/prisma/client';
import { formatDateOnly } from '../../../../common';
import type { EventReviewSectionDto } from '../../dto/event-review-response.dto';

/** Check-in rows ordered by date ascending within the event window. */
export interface ReviewActionCheckIn {
  date: Date;
  outcome: HealthEventOutcome;
}

/** Dose-log facts inside the event window (reader-port shape). */
export interface ReviewActionDoseLog {
  reminderId: string | null;
  status: DoseLogStatus;
  scheduledFor: Date;
  scheduledTime: string | null;
}

/** Facts the completedActions section consumes. */
export interface ReviewActionFacts {
  doseLogs: ReviewActionDoseLog[];
  checkIns: ReviewActionCheckIn[];
}

/** Per-slot dose statistics; unconfirmed is never counted as a failure. */
export interface ReviewDoseSlotCounts {
  confirmed: number;
  skipped: number;
  unconfirmed: number;
}

/**
 * CompletedActions section builder.
 *
 * Counts dose slots by final status (taken → confirmed, skipped → skipped,
 * planned/missed → unconfirmed) using the same slot identity and priority
 * merge as the dashboard medication metric, and lists the user's completed
 * check-ins. Unconfirmed slots are reported factually — they are neither
 * failures nor completions.
 */
@Injectable()
export class EventReviewActionsService {
  build(input: ReviewActionFacts): EventReviewSectionDto {
    const doseSlots = this.countDoseSlots(input.doseLogs);
    const checkIns = input.checkIns.map((checkIn) => ({
      date: formatDateOnly(checkIn.date),
      outcome: checkIn.outcome,
    }));

    if (doseSlots.confirmed + doseSlots.skipped + checkIns.length === 0) {
      return { state: 'unknown', reasonCode: 'no_completed_actions' };
    }

    return {
      state: 'available',
      facts: {
        code: 'completed_actions',
        arguments: { doseSlots, checkIns },
      },
    };
  }

  private countDoseSlots(
    doseLogs: ReviewActionDoseLog[],
  ): ReviewDoseSlotCounts {
    // Reminder-linked rows share one row per (reminder, day) in the DB, but
    // keep the dashboard-style priority merge in case the reader port ever
    // returns several statuses for the same slot.
    const slotStatuses = new Map<string, DoseLogStatus>();
    const standaloneStatuses: DoseLogStatus[] = [];
    for (const log of doseLogs) {
      if (log.reminderId == null) {
        // Temporary logs have no stable slot identity other than their own
        // row; each row is its own slot.
        standaloneStatuses.push(log.status);
        continue;
      }
      const key = [
        log.reminderId,
        formatDateOnly(log.scheduledFor),
        log.scheduledTime ?? '',
      ].join('|');
      const previous = slotStatuses.get(key);
      if (
        previous == null ||
        this.statusPriority(log.status) > this.statusPriority(previous)
      ) {
        slotStatuses.set(key, log.status);
      }
    }

    let confirmed = 0;
    let skipped = 0;
    let unconfirmed = 0;
    for (const status of [...slotStatuses.values(), ...standaloneStatuses]) {
      if (status === DoseLogStatus.taken) {
        confirmed += 1;
      } else if (status === DoseLogStatus.skipped) {
        skipped += 1;
      } else {
        // planned | missed — unconfirmed, explicitly not a failure.
        unconfirmed += 1;
      }
    }
    return { confirmed, skipped, unconfirmed };
  }

  private statusPriority(status: DoseLogStatus): number {
    if (status === DoseLogStatus.taken) {
      return 4;
    }
    if (status === DoseLogStatus.skipped) {
      return 3;
    }
    if (status === DoseLogStatus.missed) {
      return 2;
    }
    return 1;
  }
}
