import { Injectable } from '@nestjs/common';
import { nonDeleted } from '../../../../common/index.js';
import {
  formatDateOnlyInTimezone,
  now,
  parseDateOnly,
} from '../../../../common/index.js';
import { DoseLogStatus, type Prisma } from '#generated/prisma/client.js';
import { PrismaService } from '../../../../prisma/index.js';
import { MedicineDoseLogReaderPort } from '../../../medicine-dose-logs/index.js';
import { MISSED_DOSE_GRACE_MINUTES } from '../../constants/thresholds.constants.js';
import type { SuggestionSignal } from '../../types/signal.types.js';
import { TriggerType } from '../../types/suggestion.types.js';
import { MedicationTimeResolverService } from './medication-time-resolver.service.js';

type DoseSlotStatus =
  | 'taken'
  | 'skipped'
  | 'unconfirmed'
  | 'overdueUnconfirmed';

type DoseLogFactShape = {
  currentMedicineId: string | null;
  reminderId: string | null;
  status: DoseLogStatus;
  scheduledTime: string | null;
  scheduledFor: Date;
};

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
    private readonly timeResolver: MedicationTimeResolverService,
  ) {}

  async collect(userId: string, date: string): Promise<SuggestionSignal[]> {
    if (!this.isValidCalendarDate(date)) {
      return [];
    }

    const day = parseDateOnly(date);
    const weekday = day.getUTCDay();
    const currentTime = now();

    const [reminders, doseLogs, currentMedicines, user] = await Promise.all([
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
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { profile: { select: { timezone: true } } },
      }),
    ]);

    const timezone = this.timeResolver.normalizeTimezone(
      user?.profile?.timezone,
    );
    const remindersForDate = reminders.filter((reminder) =>
      this.matchesDate(reminder, day, weekday),
    );
    const doseLogIndex = this.indexDoseLogsBySlot(
      doseLogs,
      date,
      remindersForDate,
    );
    let pendingCount = 0;
    let completedCount = 0;
    const slotStatuses: DoseSlotStatus[] = [];

    const signals: SuggestionSignal[] = [];

    // Reminder slots are evaluated independently. A completed slot must not
    // hide another slot for the same medicine on the same day.
    for (const medicine of currentMedicines) {
      const matchingReminders = remindersForDate.filter(
        (r) => r.currentMedicineId === medicine.id,
      );

      for (const reminder of matchingReminders) {
        const scheduledTime = this.timeResolver.formatScheduledTime(
          reminder.scheduledHour,
          reminder.scheduledMinute,
        );
        const slotKey = this.reminderSlotKey(
          medicine.id,
          reminder.id,
          date,
          scheduledTime,
        );
        const loggedStatus = doseLogIndex.reminderStatuses.get(slotKey);
        const scheduledInstant = this.timeResolver.scheduledInstant(
          date,
          scheduledTime,
          timezone,
        );
        const overdueMinutes =
          scheduledInstant == null
            ? 0
            : Math.floor(
                (currentTime.getTime() - scheduledInstant.getTime()) / 60_000,
              );
        const status = this.resolveSlotStatus(
          loggedStatus,
          overdueMinutes,
          scheduledInstant != null,
        );
        slotStatuses.push(status);
        const payload = {
          medicineId: medicine.id,
          medicineName: medicine.displayName,
          reminderId: reminder.id,
          scheduledFor: date,
          scheduledTime,
          scheduledHour: reminder.scheduledHour,
          scheduledMinute: reminder.scheduledMinute,
          status,
          overdueMinutes: Math.max(overdueMinutes, 0),
          isOverdue: status === 'overdueUnconfirmed',
        };

        if (status === 'taken' || status === 'skipped') {
          completedCount += 1;
        } else {
          pendingCount += 1;
        }

        signals.push({
          signalId: `med_${status}_${medicine.id}_${reminder.id}`,
          source: 'medication',
          kind: status,
          recordedAt: day,
          userId,
          triggerType: TriggerType.EVENT,
          payload,
        });

        if (status !== 'taken' && status !== 'skipped') {
          // Legacy compatibility signal. The missed-dose rule consumes only
          // `overdueUnconfirmed`; summary counts use slot statuses directly.
          signals.push({
            signalId: `med_pending_${medicine.id}_${reminder.id}`,
            source: 'medication',
            kind: 'pending_dose',
            recordedAt: day,
            userId,
            triggerType: TriggerType.EVENT,
            payload,
          });
        }
      }

      // If there are no matching reminders but the medicine has no dose log,
      // still emit a generic "unconfirmed" signal
      if (matchingReminders.length === 0) {
        const temporaryLogs = doseLogIndex.temporaryLogs.filter(
          (log) => log.currentMedicineId === medicine.id,
        );
        if (temporaryLogs.length === 0) {
          pendingCount += 1;
        } else {
          for (const log of temporaryLogs) {
            if (
              log.status === DoseLogStatus.taken ||
              log.status === DoseLogStatus.skipped
            ) {
              completedCount += 1;
            } else {
              pendingCount += 1;
            }
          }
        }
        if (temporaryLogs.length === 0) {
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
    }

    const reminderStatuses = slotStatuses;
    const expectedCount = reminderStatuses.length;
    const takenCount = reminderStatuses.filter(
      (status) => status === 'taken',
    ).length;
    const skippedCount = reminderStatuses.filter(
      (status) => status === 'skipped',
    ).length;
    const overdueUnconfirmedCount = reminderStatuses.filter(
      (status) => status === 'overdueUnconfirmed',
    ).length;
    const observedCount = takenCount + skippedCount;
    const hasPlan = expectedCount > 0;

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
        // `pending_dose` is a legacy compatibility signal and is not part of
        // the summary; counts are based on reminder slots or medicine facts.
        pendingCount,
        completedCount,
        skippedCount,
        overdueUnconfirmedCount,
        medicineNames: currentMedicines.map((m) => m.displayName),
        observedMetric: {
          value:
            hasPlan && observedCount > 0
              ? Number(((takenCount / expectedCount) * 100).toFixed(0))
              : null,
          state: observedCount > 0 ? 'observed' : 'unknown',
          coverage:
            observedCount === 0
              ? 'none'
              : observedCount === expectedCount
                ? 'sufficient'
                : 'partial',
          sources: hasPlan ? ['reminder_plan'] : [],
          observedCount,
          expectedCount: hasPlan ? expectedCount : null,
          takenCount,
          skippedCount,
          unconfirmedCount: reminderStatuses.filter(
            (status) => status === 'unconfirmed',
          ).length,
          overdueUnconfirmedCount,
          windowStart: day.toISOString(),
          windowEnd: new Date(day.getTime() + 86_400_000).toISOString(),
        },
      },
    });

    return signals;
  }

  private indexDoseLogsBySlot(
    doseLogs: DoseLogFactShape[],
    date: string,
    reminders: ReminderShape[],
  ): {
    reminderStatuses: Map<string, DoseLogStatus>;
    temporaryLogs: DoseLogFactShape[];
  } {
    const bySlot = new Map<string, DoseLogStatus>();
    const temporaryLogs: DoseLogFactShape[] = [];
    const reminderIdsByTime = new Map<string, string[]>();
    for (const reminder of reminders) {
      if (reminder.currentMedicineId == null) {
        continue;
      }
      const scheduledTime = this.timeResolver.formatScheduledTime(
        reminder.scheduledHour,
        reminder.scheduledMinute,
      );
      const key = this.slotKey(reminder.currentMedicineId, scheduledTime);
      const ids = reminderIdsByTime.get(key) ?? [];
      if (!ids.includes(reminder.id)) ids.push(reminder.id);
      reminderIdsByTime.set(key, ids);
    }

    const recordStatus = (key: string, status: DoseLogStatus): void => {
      const existing = bySlot.get(key);
      if (
        existing == null ||
        this.statusPriority(status) > this.statusPriority(existing)
      ) {
        bySlot.set(key, status);
      }
    };

    for (const log of doseLogs) {
      if (log.currentMedicineId == null) {
        continue;
      }
      if (formatDateOnlyInTimezone(log.scheduledFor, 'UTC') !== date) {
        continue;
      }

      if (log.reminderId != null) {
        recordStatus(
          this.reminderSlotKey(
            log.currentMedicineId,
            log.reminderId,
            formatDateOnlyInTimezone(log.scheduledFor, 'UTC'),
            this.timeResolver.normalizeScheduledTime(log.scheduledTime ?? '') ??
              this.reminderTime(log.reminderId, reminders),
          ),
          log.status,
        );
        continue;
      }

      const scheduledTime = this.timeResolver.normalizeScheduledTime(
        log.scheduledTime ?? '',
      );
      const reminderIds =
        scheduledTime == null
          ? undefined
          : reminderIdsByTime.get(
              this.slotKey(log.currentMedicineId, scheduledTime),
            );
      if (reminderIds?.length === 1) {
        const reminderId = reminderIds[0];
        if (reminderId != null) {
          recordStatus(
            this.reminderSlotKey(
              log.currentMedicineId,
              reminderId,
              formatDateOnlyInTimezone(log.scheduledFor, 'UTC'),
              scheduledTime,
            ),
            log.status,
          );
          continue;
        }
      }

      // A temporary log is an observation in its own slot, even when its
      // medicine/date/time match another temporary log or reminder.
      temporaryLogs.push(log);
    }
    return { reminderStatuses: bySlot, temporaryLogs };
  }

  private resolveSlotStatus(
    loggedStatus: DoseLogStatus | undefined,
    overdueMinutes: number,
    hasScheduledInstant: boolean,
  ): DoseSlotStatus {
    if (loggedStatus === DoseLogStatus.taken) return 'taken';
    if (loggedStatus === DoseLogStatus.skipped) return 'skipped';
    if (!hasScheduledInstant || overdueMinutes <= 0) return 'unconfirmed';
    if (overdueMinutes > MISSED_DOSE_GRACE_MINUTES) {
      return 'overdueUnconfirmed';
    }
    return 'unconfirmed';
  }

  private statusPriority(status: DoseLogStatus): number {
    if (status === DoseLogStatus.taken) return 4;
    if (status === DoseLogStatus.skipped) return 3;
    if (status === DoseLogStatus.missed) return 2;
    return 1;
  }

  private slotKey(medicineId: string, scheduledTime: string): string {
    return `${medicineId}|${scheduledTime}`;
  }

  private reminderSlotKey(
    medicineId: string,
    reminderId: string,
    date?: string,
    scheduledTime?: string | null,
  ): string {
    return `${medicineId}|${reminderId}|${date ?? ''}|${scheduledTime ?? ''}`;
  }

  private reminderTime(
    reminderId: string,
    reminders: ReminderShape[],
  ): string | null {
    const reminder = reminders.find((candidate) => candidate.id === reminderId);
    return reminder == null
      ? null
      : this.timeResolver.formatScheduledTime(
          reminder.scheduledHour,
          reminder.scheduledMinute,
        );
  }

  private isValidCalendarDate(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (match == null) {
      return false;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const candidate = new Date(0);
    candidate.setUTCFullYear(year, month - 1, day);
    candidate.setUTCHours(0, 0, 0, 0);

    return (
      candidate.getUTCFullYear() === year &&
      candidate.getUTCMonth() === month - 1 &&
      candidate.getUTCDate() === day
    );
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
