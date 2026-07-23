import { Injectable } from '@nestjs/common';
import { nonDeleted } from '../../../../common/helpers';
import { parseDateOnly } from '../../../../common/helpers';
import { DoseLogStatus, type Prisma } from '#generated/prisma/client';
import { PrismaService } from '../../../../prisma';
import { MedicineDoseLogReaderPort } from '../../../medicine-dose-logs/repositories';
import type { SuggestionSignal } from '../../../today-suggestion/types';
import { TriggerType } from '../../../today-suggestion/types';

const _reminderSelect = {
  id: true,
  currentMedicineId: true,
  scheduledHour: true,
  scheduledMinute: true,
  daysOfWeek: true,
  startDate: true,
  endDate: true,
} satisfies Prisma.UserMedicineReminderSelect;

type ReminderShape = Prisma.UserMedicineReminderGetPayload<{
  select: typeof _reminderSelect;
}>;

/**
 * Collects medication-related signals:
 * pending doses, overdue reminders, and current medicine list.
 */
@Injectable()
export class MedicationCollectorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly doseLogReader: MedicineDoseLogReaderPort,
  ) {}

  async collect(userId: string, date: string): Promise<SuggestionSignal[]> {
    const day = parseDateOnly(date);
    const weekday = day.getUTCDay();

    const [reminders, doseLogs, currentMedicines] = await Promise.all([
      this.prisma.userMedicineReminder.findMany({
        where: { userId, isActive: true, ...nonDeleted },
        select: _reminderSelect,
        orderBy: [{ scheduledHour: 'asc' }, { scheduledMinute: 'asc' }],
      }),
      this.doseLogReader.listFactsInRange(userId, day, day),
      this.prisma.userCurrentMedicine.findMany({
        where: { userId, isCurrent: true },
        select: {
          id: true,
          displayName: true,
        },
        orderBy: [{ createdAt: 'asc' }],
      }),
    ]);

    const completedMedicineIds = new Set(
      doseLogs
        .filter(
          (log) =>
            log.currentMedicineId != null &&
            (log.status === DoseLogStatus.taken ||
              log.status === DoseLogStatus.skipped),
        )
        .map((log) => log.currentMedicineId)
        .filter((id): id is string => id != null),
    );

    const signals: SuggestionSignal[] = [];

    // Pending dose signals
    for (const medicine of currentMedicines) {
      if (completedMedicineIds.has(medicine.id)) {
        continue;
      }

      const matchingReminders = reminders.filter(
        (r) =>
          r.currentMedicineId === medicine.id &&
          this.matchesDate(r, day, weekday),
      );

      for (const reminder of matchingReminders) {
        const scheduledMinutes =
          reminder.scheduledHour * 60 + reminder.scheduledMinute;
        const nowMinutes = day.getUTCHours() * 60 + day.getUTCMinutes();
        const overdueMinutes = nowMinutes - scheduledMinutes;

        signals.push({
          signalId: `med_pending_${medicine.id}_${String(reminder.scheduledHour)}_${String(reminder.scheduledMinute)}`,
          source: 'medication',
          kind: 'pending_dose',
          recordedAt: day,
          userId,
          triggerType: TriggerType.EVENT,
          payload: {
            medicineId: medicine.id,
            medicineName: medicine.displayName,
            scheduledHour: reminder.scheduledHour,
            scheduledMinute: reminder.scheduledMinute,
            overdueMinutes: Math.max(overdueMinutes, 0),
            isOverdue: overdueMinutes > 0,
          },
        });
      }

      // If there are no matching reminders but the medicine has no dose log,
      // still emit a generic "unconfirmed" signal
      if (matchingReminders.length === 0) {
        signals.push({
          signalId: `med_unconfirmed_${medicine.id}`,
          source: 'medication',
          kind: 'unconfirmed_medicine',
          recordedAt: day,
          userId,
          triggerType: TriggerType.EVENT,
          payload: {
            medicineId: medicine.id,
            medicineName: medicine.displayName,
          },
        });
      }
    }

    // Current medicines summary signal
    signals.push({
      signalId: `med_summary`,
      source: 'medication',
      kind: 'medication_summary',
      recordedAt: day,
      userId,
      triggerType: TriggerType.TIMER,
      payload: {
        totalMedicines: currentMedicines.length,
        pendingCount: currentMedicines.filter(
          (m) => !completedMedicineIds.has(m.id),
        ).length,
        completedCount: currentMedicines.filter((m) =>
          completedMedicineIds.has(m.id),
        ).length,
        medicineNames: currentMedicines.map((m) => m.displayName),
      },
    });

    return signals;
  }

  private matchesDate(
    reminder: ReminderShape,
    day: Date,
    weekday: number,
  ): boolean {
    if (reminder.startDate != null && day < reminder.startDate) {
      return false;
    }
    if (reminder.endDate != null && day > reminder.endDate) {
      return false;
    }

    const daysOfWeek = this.parseDaysOfWeek(reminder.daysOfWeek);
    if (daysOfWeek == null) {
      return true;
    }

    return daysOfWeek.includes(weekday);
  }

  private parseDaysOfWeek(value: unknown): number[] | null {
    if (!Array.isArray(value)) {
      return null;
    }
    const days = value.filter((d): d is number => typeof d === 'number');
    return days.length > 0 ? days : null;
  }
}
