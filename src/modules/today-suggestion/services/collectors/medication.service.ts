import { Injectable, Logger } from '@nestjs/common';
import { nonDeleted } from '../../../../common/index.js';
import {
  DEFAULT_USER_TIMEZONE,
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
  private readonly logger = new Logger(MedicationCollectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly doseLogReader: MedicineDoseLogReaderPort,
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

    const timezone = this.normalizeTimezone(user?.profile?.timezone);
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
        const scheduledTime = this.formatScheduledTime(
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
        const scheduledInstant = this.scheduledInstant(
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
      const scheduledTime = this.formatScheduledTime(
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
            this.normalizeScheduledTime(log.scheduledTime ?? '') ??
              this.reminderTime(log.reminderId, reminders),
          ),
          log.status,
        );
        continue;
      }

      const scheduledTime = this.normalizeScheduledTime(
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
      : this.formatScheduledTime(
          reminder.scheduledHour,
          reminder.scheduledMinute,
        );
  }

  private formatScheduledTime(hour: number, minute: number): string {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  private normalizeScheduledTime(value: string): string | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (match == null) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return this.formatScheduledTime(hour, minute);
  }

  private scheduledInstant(
    date: string,
    scheduledTime: string,
    timezone: string,
  ): Date | null {
    const normalizedTime = this.normalizeScheduledTime(scheduledTime);
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (normalizedTime == null || dateMatch == null) return null;

    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const [hour = 0, minute = 0] = normalizedTime.split(':').map(Number);
    const naiveUtc = Date.UTC(year, month - 1, day, hour, minute);
    const naiveDate = new Date(naiveUtc);
    if (
      naiveDate.getUTCFullYear() !== year ||
      naiveDate.getUTCMonth() !== month - 1 ||
      naiveDate.getUTCDate() !== day
    ) {
      return null;
    }

    const candidateOffsets = new Set<number>();
    for (const offset of [-48, -24, 0, 24, 48]) {
      candidateOffsets.add(
        this.timezoneOffsetMinutes(
          new Date(naiveUtc + offset * 60 * 60 * 1000),
          timezone,
        ),
      );
    }

    const candidates = [...candidateOffsets]
      .map((offsetMinutes) => new Date(naiveUtc - offsetMinutes * 60 * 1000))
      .filter((candidate) =>
        this.isSameLocalMinute(
          candidate,
          year,
          month,
          day,
          hour,
          minute,
          timezone,
        ),
      )
      .sort((left, right) => left.getTime() - right.getTime());

    // A DST fold has two valid instants. Choose the earlier occurrence
    // deterministically; a DST gap has no round-tripping candidate and returns
    // null instead of inventing an instant.
    return candidates[0] ?? null;
  }

  private timezoneOffsetMinutes(date: Date, timezone: string): number {
    const localParts = this.zonedParts(date, timezone);
    const localAsUtc = Date.UTC(
      localParts.year,
      localParts.month - 1,
      localParts.day,
      localParts.hour,
      localParts.minute,
    );
    return Math.round((localAsUtc - date.getTime()) / 60_000);
  }

  private isSameLocalMinute(
    date: Date,
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    timezone: string,
  ): boolean {
    const parts = this.zonedParts(date, timezone);
    return (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute
    );
  }

  private zonedParts(
    date: Date,
    timezone: string,
  ): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  } {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const value = (type: string): number =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    return {
      year: value('year'),
      month: value('month'),
      day: value('day'),
      hour: value('hour'),
      minute: value('minute'),
    };
  }

  private normalizeTimezone(timezone: unknown): string {
    if (typeof timezone !== 'string') {
      return DEFAULT_USER_TIMEZONE;
    }

    const trimmed = timezone.trim();
    if (trimmed.length === 0) {
      return DEFAULT_USER_TIMEZONE;
    }

    try {
      new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(
        new Date(0),
      );
      return trimmed;
    } catch (error) {
      this.logger.warn(
        `Invalid timezone "${trimmed}", falling back to default: ${error instanceof Error ? error.message : String(error)}`,
      );
      return DEFAULT_USER_TIMEZONE;
    }
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
