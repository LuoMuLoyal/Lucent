/**
 * Shared orchestration for the two create-shaped use cases (`create`, `mark`).
 *
 * Both run the same four steps before writing:
 *
 * 1. validate the health event, when one is attached;
 * 2. look the reminder up (ownership proof + slot schedule);
 * 3. reject a medicine that contradicts the reminder;
 * 4. resolve which current medicine to link, and prove it is owned;
 *
 * only the write itself differs (`create` inserts, `mark` upserts the slot).
 * Keeping the steps here means the two cannot drift — they used to be duplicated
 * line for line, so a fix in one silently missed the other.
 */

import {
  contradictsReminderMedicine,
  resolveMedicineId,
  resolveScheduledTime,
  type DoseTarget,
} from '../../domain/dose-log/dose-log.js';
import type { ReminderSchedule } from '../../domain/dose-log/dose-logs.js';
// Constructor token: must be a value import for Nest to resolve it.
import { DoseLogs } from '../../domain/dose-log/dose-logs.js';
import { HealthEventGuard } from '../ports/health-event-guard.js';
import { notFound, unresolvedTarget } from './failures.js';

/** What a caller supplies before the target is resolvable. */
export interface TargetInput {
  reminderId: string | undefined;
  currentMedicineId: string | undefined;
  scheduledFor: Date;
  scheduledTime: string | undefined;
}

export class DoseTargetResolver {
  constructor(
    private readonly repository: DoseLogs,
    private readonly healthEvents: HealthEventGuard,
  ) {}

  /**
   * Validates the health event and resolves the write target.
   *
   * The medicine check is skipped when neither side names one: an unlinked dose
   * log is legitimate (the medicine was removed from the box afterwards).
   */
  async resolve(
    userId: string,
    input: TargetInput,
    healthEventId: string | null | undefined,
  ): Promise<DoseTarget> {
    if (healthEventId != null) {
      await this.healthEvents.ensureActiveOwnedByUser(userId, healthEventId);
    }

    const reminder = await this.loadReminder(userId, input.reminderId);
    const reminderMedicineId = reminder?.currentMedicineId ?? null;
    const requested = input.currentMedicineId ?? null;

    if (contradictsReminderMedicine(requested, reminderMedicineId)) {
      unresolvedTarget();
    }

    const medicineId = resolveMedicineId(requested, reminderMedicineId);
    if (medicineId !== null) {
      const owned = await this.repository.findOwnedCurrentMedicine(
        userId,
        medicineId,
      );
      if (owned === null) {
        notFound();
      }
    }

    return {
      currentMedicineId: medicineId,
      reminderId: input.reminderId ?? null,
      scheduledFor: input.scheduledFor,
      scheduledTime: resolveScheduledTime(
        input.scheduledTime ?? null,
        reminder === null
          ? null
          : { hour: reminder.scheduledHour, minute: reminder.scheduledMinute },
      ),
    };
  }

  private async loadReminder(
    userId: string,
    reminderId: string | undefined,
  ): Promise<ReminderSchedule | null> {
    if (reminderId === undefined) {
      return null;
    }
    const reminder = await this.repository.findReminder(userId, reminderId);
    if (reminder === null) {
      notFound();
    }
    return reminder;
  }
}
