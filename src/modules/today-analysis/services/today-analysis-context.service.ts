import { Injectable } from '@nestjs/common';
import {
  DoseLogStatus,
  type DailyRecordKind,
  type Prisma,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

const DEFAULT_WATER_TARGET_COUNT = 8;
const MAX_RECENT_RECORDS = 8;
const MAX_CURRENT_MEDICINE_NAMES = 5;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const dailyRecordSelect = {
  kind: true,
  occurredTime: true,
  title: true,
  value: true,
  unit: true,
  note: true,
  payload: true,
  createdAt: true,
} satisfies Prisma.UserDailyRecordSelect;

type DailyRecordShape = Prisma.UserDailyRecordGetPayload<{
  select: typeof dailyRecordSelect;
}>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const reminderSelect = {
  currentMedicineId: true,
  scheduledHour: true,
  scheduledMinute: true,
  daysOfWeek: true,
  startDate: true,
  endDate: true,
  createdAt: true,
} satisfies Prisma.UserMedicineReminderSelect;

type ReminderShape = Prisma.UserMedicineReminderGetPayload<{
  select: typeof reminderSelect;
}>;

export interface TodayAnalysisContext {
  date: string;
  water: {
    completedCount: number;
    targetCount: number;
    remainingCount: number;
  };
  medication: {
    medicineCount: number;
    pendingCount: number;
    nextDoseTimeLabel: string;
    nextMedicineName: string | null;
    currentMedicineNames: string[];
  };
  recordSummary: Array<{
    kind: string;
    count: number;
  }>;
  recentRecords: Array<{
    kind: string;
    title: string | null;
    value: string | null;
    unit: string | null;
    note: string | null;
    createdAt: string;
  }>;
  sleep: {
    status: 'ok' | 'insufficient_data';
    durationMinutes: number | null;
    quality: string | null;
    startAt: string | null;
    endAt: string | null;
    deepMinutes: number | null;
    lightMinutes: number | null;
    remMinutes: number | null;
  };
  lowRiskContext: {
    activeAllergyCount: number;
    currentMedicineCount: number;
  };
}

@Injectable()
export class TodayAnalysisContextService {
  constructor(private readonly prisma: PrismaService) {}

  async build(userId: string, date: string): Promise<TodayAnalysisContext> {
    const day = this.parseDate(date);
    const weekday = day.getUTCDay();

    const [
      currentMedicines,
      reminders,
      doseLogs,
      dailyRecords,
      activeAllergyCount,
    ] = await Promise.all([
      this.prisma.userCurrentMedicine.findMany({
        where: {
          userId,
          isCurrent: true,
        },
        select: {
          id: true,
          displayName: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }],
      }),
      this.prisma.userMedicineReminder.findMany({
        where: {
          userId,
          isActive: true,
          deletedAt: null,
        },
        select: {
          currentMedicineId: true,
          scheduledHour: true,
          scheduledMinute: true,
          daysOfWeek: true,
          startDate: true,
          endDate: true,
          createdAt: true,
        },
        orderBy: [
          { scheduledHour: 'asc' },
          { scheduledMinute: 'asc' },
          { createdAt: 'asc' },
        ],
      }),
      this.prisma.userMedicineDoseLog.findMany({
        where: {
          userId,
          deletedAt: null,
          scheduledFor: day,
        },
        select: {
          currentMedicineId: true,
          status: true,
        },
      }),
      this.prisma.userDailyRecord.findMany({
        where: {
          userId,
          deletedAt: null,
          occurredAt: day,
        },
        select: {
          kind: true,
          occurredTime: true,
          title: true,
          value: true,
          unit: true,
          note: true,
          payload: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }],
      }),
      this.prisma.userAllergy.count({
        where: {
          userId,
          isActive: true,
        },
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

    const pendingMedicines = currentMedicines.filter(
      (medicine) => !completedMedicineIds.has(medicine.id),
    );
    const pendingMedicineIds = new Set(pendingMedicines.map((item) => item.id));
    const nextReminder = reminders.find((reminder) =>
      this.matchesDate(reminder, day, weekday, pendingMedicineIds),
    );
    const nextReminderMedicine = pendingMedicines.find(
      (medicine) => medicine.id === nextReminder?.currentMedicineId,
    );

    const waterCompletedCount = dailyRecords.filter(
      (record) => record.kind === 'water',
    ).length;
    const recordSummary = this.buildRecordSummary(dailyRecords);
    const recentRecords = dailyRecords
      .slice(0, MAX_RECENT_RECORDS)
      .map((record) => this.toRecentRecord(record));
    const sleepData = this.buildSleepContext(dailyRecords);

    return {
      date,
      water: {
        completedCount: waterCompletedCount,
        targetCount: DEFAULT_WATER_TARGET_COUNT,
        remainingCount: Math.max(
          DEFAULT_WATER_TARGET_COUNT - waterCompletedCount,
          0,
        ),
      },
      medication: {
        medicineCount: currentMedicines.length,
        pendingCount: pendingMedicines.length,
        nextDoseTimeLabel: nextReminder
          ? this.toTimeLabel(
              nextReminder.scheduledHour,
              nextReminder.scheduledMinute,
            )
          : '--',
        nextMedicineName: nextReminderMedicine?.displayName ?? null,
        currentMedicineNames: currentMedicines
          .map((medicine) => medicine.displayName.trim())
          .filter((name) => name.length > 0)
          .slice(0, MAX_CURRENT_MEDICINE_NAMES),
      },
      recordSummary,
      recentRecords,
      sleep: sleepData,
      lowRiskContext: {
        activeAllergyCount,
        currentMedicineCount: currentMedicines.length,
      },
    };
  }

  private buildRecordSummary(dailyRecords: DailyRecordShape[]) {
    const counts = new Map<string, number>();
    for (const record of dailyRecords) {
      counts.set(record.kind, (counts.get(record.kind) ?? 0) + 1);
    }

    return Array.from(counts.entries()).map(([kind, count]) => ({
      kind,
      count,
    }));
  }

  // Sleep date convention: a sleep record's `occurredAt` is the wake date
  // (the morning the user wakes up). Querying by `occurredAt = day` returns
  // the sleep the user woke up on that calendar day.
  private buildSleepContext(dailyRecords: DailyRecordShape[]): {
    status: 'ok' | 'insufficient_data';
    durationMinutes: number | null;
    quality: string | null;
    startAt: string | null;
    endAt: string | null;
    deepMinutes: number | null;
    lightMinutes: number | null;
    remMinutes: number | null;
  } {
    const emptyResult = {
      status: 'insufficient_data' as const,
      durationMinutes: null,
      quality: null,
      startAt: null,
      endAt: null,
      deepMinutes: null,
      lightMinutes: null,
      remMinutes: null,
    };

    const sleepRecord = dailyRecords.find(
      (record) => record.kind === ('sleep' as DailyRecordKind),
    );

    if (sleepRecord == null) {
      return emptyResult;
    }

    const payload = sleepRecord.payload as Record<string, unknown> | null;
    if (payload == null) {
      return emptyResult;
    }

    const durationMinutes =
      typeof payload['durationMinutes'] === 'number'
        ? payload['durationMinutes']
        : null;
    const quality =
      typeof payload['quality'] === 'string' ? payload['quality'] : null;
    const startAt =
      typeof payload['startAt'] === 'string' ? payload['startAt'] : null;
    const endAt =
      typeof payload['endAt'] === 'string' ? payload['endAt'] : null;
    const deepMinutes =
      typeof payload['deepMinutes'] === 'number'
        ? payload['deepMinutes']
        : null;
    const lightMinutes =
      typeof payload['lightMinutes'] === 'number'
        ? payload['lightMinutes']
        : null;
    const remMinutes =
      typeof payload['remMinutes'] === 'number' ? payload['remMinutes'] : null;

    return {
      status:
        durationMinutes != null && durationMinutes > 0
          ? 'ok'
          : 'insufficient_data',
      durationMinutes,
      quality,
      startAt,
      endAt,
      deepMinutes,
      lightMinutes,
      remMinutes,
    };
  }

  private toRecentRecord(record: DailyRecordShape) {
    return {
      kind: record.kind,
      title: this.trimNullableText(record.title),
      value: this.trimNullableText(record.value),
      unit: this.trimNullableText(record.unit),
      note: this.trimNullableText(record.note),
      createdAt: record.createdAt.toISOString(),
    };
  }

  private trimNullableText(value: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
  }

  private matchesDate(
    reminder: ReminderShape,
    day: Date,
    weekday: number,
    pendingMedicineIds: Set<string>,
  ): boolean {
    if (
      reminder.currentMedicineId == null ||
      !pendingMedicineIds.has(reminder.currentMedicineId)
    ) {
      return false;
    }

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

    const days = value.filter((day): day is number => typeof day === 'number');
    return days.length > 0 ? days : null;
  }

  private toTimeLabel(hour: number, minute: number): string {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  private parseDate(date: string): Date {
    return new Date(`${date}T00:00:00.000Z`);
  }
}
