import { BadRequestException, Injectable } from '@nestjs/common';
import { nonDeleted } from '../../../common/utils/prisma.helpers';
import {
  formatDateOnly,
  parseDateOnly,
} from '../../../common/utils/date-time.utils';
import {
  DoseLogStatus,
  DailyRecordKind,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { USER_SETTING_KEYS } from '../../user-settings/config/user-settings.constants';
import {
  REPORT_RANGE_CUSTOM,
  REPORT_RANGE_LAST_30_DAYS,
  REPORT_RANGE_LAST_7_DAYS,
  type ReportDashboardQueryDto,
} from '../dto';
import type { ReportDashboardFacts } from './reports.types';

@Injectable()
export class ReportsContextService {
  constructor(private readonly prisma: PrismaService) {}

  async build(
    userId: string,
    query: ReportDashboardQueryDto,
  ): Promise<ReportDashboardFacts> {
    const range = query.range ?? REPORT_RANGE_LAST_7_DAYS;
    const endDate = this.resolveEndDate(range, query);
    const startDate = this.resolveStartDate(endDate, range, query);

    const [settings, doseLogs, dailyRecords] = await Promise.all([
      this.prisma.userSetting.findFirst({
        where: { userId, key: USER_SETTING_KEYS.aiSummariesEnabled },
        select: { value: true },
      }),
      this.prisma.userMedicineDoseLog.findMany({
        where: {
          userId,
          ...nonDeleted,
          scheduledFor: {
            gte: startDate,
            lte: endDate,
          },
        },
        select: {
          scheduledFor: true,
          status: true,
        },
        orderBy: { scheduledFor: 'asc' },
      }),
      this.prisma.userDailyRecord.findMany({
        where: {
          userId,
          ...nonDeleted,
          occurredAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        select: {
          occurredAt: true,
          kind: true,
          value: true,
          unit: true,
          payload: true,
        },
        orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    return {
      range,
      startDate,
      endDate,
      generatedAt: new Date().toISOString(),
      aiSummaryEnabled: settings?.value !== false,
      medicationSeries: this.buildMedicationSeries(
        doseLogs,
        startDate,
        endDate,
      ),
      waterSeries: this.buildWaterSeries(dailyRecords, startDate, endDate),
      sleepSeries: this.buildSleepSeries(dailyRecords, startDate, endDate),
    };
  }

  private buildMedicationSeries(
    doseLogs: Array<{ scheduledFor: Date; status: DoseLogStatus }>,
    startDate: Date,
    endDate: Date,
  ): number[] {
    const plannedByDay = new Map<string, number>();
    const completedByDay = new Map<string, number>();

    for (const log of doseLogs) {
      const day = this.toDateString(log.scheduledFor);
      plannedByDay.set(day, (plannedByDay.get(day) ?? 0) + 1);
      if (log.status === DoseLogStatus.taken) {
        completedByDay.set(day, (completedByDay.get(day) ?? 0) + 1);
      }
    }

    return this.eachDay(startDate, endDate).map((date) => {
      const day = this.toDateString(date);
      const planned = plannedByDay.get(day) ?? 0;
      if (planned === 0) {
        return 0;
      }
      const completed = completedByDay.get(day) ?? 0;
      return Number(((completed / planned) * 100).toFixed(0));
    });
  }

  private buildWaterSeries(
    dailyRecords: Array<{
      occurredAt: Date;
      kind: DailyRecordKind;
      value: string | null;
      unit: string | null;
    }>,
    startDate: Date,
    endDate: Date,
  ): number[] {
    const totalsByDay = new Map<string, number>();

    for (const record of dailyRecords) {
      if (record.kind !== DailyRecordKind.water) {
        continue;
      }

      const liters = this.parseWaterLiters(record.value, record.unit);
      if (liters == null) {
        continue;
      }

      const day = this.toDateString(record.occurredAt);
      totalsByDay.set(
        day,
        Number(((totalsByDay.get(day) ?? 0) + liters).toFixed(2)),
      );
    }

    return this.eachDay(startDate, endDate).map((date) => {
      const total = totalsByDay.get(this.toDateString(date)) ?? 0;
      return Number(total.toFixed(2));
    });
  }

  // Sleep date convention: `occurredAt` is the wake date. Each data point
  // in the sleep series represents the sleep the user woke up on that day.
  private buildSleepSeries(
    dailyRecords: Array<{
      occurredAt: Date;
      kind: DailyRecordKind;
      payload: unknown;
    }>,
    startDate: Date,
    endDate: Date,
  ): number[] {
    const durationByDay = new Map<string, number>();

    for (const record of dailyRecords) {
      if (record.kind !== DailyRecordKind.sleep) {
        continue;
      }

      const payload = record.payload as Record<string, unknown> | null;
      if (payload == null || typeof payload['durationMinutes'] !== 'number') {
        continue;
      }

      const hours = Number((payload['durationMinutes'] / 60).toFixed(1));
      if (hours <= 0) {
        continue;
      }

      const day = this.toDateString(record.occurredAt);
      durationByDay.set(day, hours);
    }

    return this.eachDay(startDate, endDate).map((date) => {
      return durationByDay.get(this.toDateString(date)) ?? 0;
    });
  }

  private parseWaterLiters(
    rawValue: string | null,
    rawUnit: string | null,
  ): number | null {
    if (!rawValue) {
      return null;
    }

    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }

    const unit = (rawUnit ?? '').trim().toLowerCase();
    if (unit === 'ml') {
      return value / 1000;
    }
    if (unit === 'l' || unit === 'liter' || unit === 'litre') {
      return value;
    }

    return value <= 10 ? value : value / 1000;
  }

  private eachDay(startDate: Date, endDate: Date): Date[] {
    const days: Date[] = [];
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      days.push(new Date(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
  }

  private todayUtc(): Date {
    return parseDateOnly(formatDateOnly(new Date()));
  }

  private toDateString(date: Date): string {
    return formatDateOnly(date);
  }

  private resolveEndDate(
    range: ReportDashboardFacts['range'],
    query: ReportDashboardQueryDto,
  ): Date {
    if (range === REPORT_RANGE_CUSTOM) {
      if (!query.endDate) {
        throw new BadRequestException(
          'endDate is required when range is custom.',
        );
      }
      const customEndDate = parseDateOnly(query.endDate);
      if (customEndDate > this.todayUtc()) {
        throw new BadRequestException('endDate must not be in the future.');
      }
      return customEndDate;
    }
    return this.todayUtc();
  }

  private resolveStartDate(
    endDate: Date,
    range: ReportDashboardFacts['range'],
    query: ReportDashboardQueryDto,
  ): Date {
    if (range === REPORT_RANGE_CUSTOM) {
      if (!query.startDate) {
        throw new BadRequestException(
          'startDate is required when range is custom.',
        );
      }
      const startDate = parseDateOnly(query.startDate);
      if (startDate > endDate) {
        throw new BadRequestException(
          'startDate must not be later than endDate.',
        );
      }
      return startDate;
    }

    const startDate = new Date(endDate);
    const days = range === REPORT_RANGE_LAST_30_DAYS ? 30 : 7;
    startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
    return startDate;
  }
}
