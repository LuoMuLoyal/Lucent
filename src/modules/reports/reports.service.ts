import { Injectable } from '@nestjs/common';
import { DoseLogStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  REPORT_RANGE_LAST_7_DAYS,
  type ReportDashboardDataDto,
  type ReportDashboardQueryDto,
} from './dto';

type MetricStatus = 'good' | 'stable' | 'needs_attention' | 'insufficient_data';
type MetricDirection = 'up' | 'down' | 'flat';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(
    userId: string,
    query: ReportDashboardQueryDto,
  ): Promise<ReportDashboardDataDto> {
    const range = query.range ?? REPORT_RANGE_LAST_7_DAYS;
    const endDate = this.todayUtc();
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - 6);

    const [settings, doseLogs, dailyRecords] = await Promise.all([
      this.prisma.userSetting.findFirst({
        where: { userId, key: 'aiSummariesEnabled' },
        select: { value: true },
      }),
      this.prisma.userMedicineDoseLog.findMany({
        where: {
          userId,
          deletedAt: null,
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
          deletedAt: null,
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
        },
        orderBy: { occurredAt: 'asc' },
      }),
    ]);

    const waterSeries = this.buildWaterSeries(dailyRecords, startDate, endDate);
    const medicationSeries = this.buildMedicationSeries(
      doseLogs,
      startDate,
      endDate,
    );
    const sleepSeries = this.buildSleepSeries(startDate, endDate);

    const medicationMetric = this.buildMedicationMetric(medicationSeries);
    const waterMetric = this.buildWaterMetric(waterSeries);
    const sleepMetric = this.buildSleepMetric(sleepSeries);

    return {
      range,
      startDate: this.toDateString(startDate),
      endDate: this.toDateString(endDate),
      generatedAt: new Date().toISOString(),
      score: this.buildScore([medicationMetric, waterMetric, sleepMetric]),
      metrics: [medicationMetric, waterMetric, sleepMetric],
      trends: [
        {
          kind: 'medication',
          unit: '%',
          currentValue: medicationMetric.value,
          values: medicationSeries,
        },
        {
          kind: 'water',
          unit: 'L',
          currentValue: waterMetric.value,
          values: waterSeries,
        },
        {
          kind: 'sleep',
          unit: 'h',
          currentValue: sleepMetric.value,
          values: sleepSeries,
        },
      ],
      findings: this.buildFindings(medicationSeries, waterSeries, sleepMetric),
      patterns: this.buildPatterns(medicationSeries, waterSeries, sleepSeries),
      aiSummaryEnabled: settings?.value === true,
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
      kind: string;
      value: string | null;
      unit: string | null;
    }>,
    startDate: Date,
    endDate: Date,
  ): number[] {
    const totalsByDay = new Map<string, number>();

    for (const record of dailyRecords) {
      if (record.kind !== 'water') {
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

  private buildSleepSeries(startDate: Date, endDate: Date): number[] {
    return this.eachDay(startDate, endDate).map(() => 0);
  }

  private buildMedicationMetric(series: number[]) {
    const nonZeroDays = series.filter((value) => value > 0);
    if (nonZeroDays.length === 0) {
      return {
        kind: 'medication' as const,
        value: '--',
        unit: '%',
        status: 'insufficient_data' as const,
        delta: '--',
        direction: 'flat' as const,
        sparkline: series,
      };
    }

    const average = Math.round(
      nonZeroDays.reduce((sum, value) => sum + value, 0) / nonZeroDays.length,
    );
    const direction = this.compareDirection(series[0] ?? average, average);

    return {
      kind: 'medication' as const,
      value: String(average),
      unit: '%',
      status:
        average >= 85
          ? ('good' as const)
          : average >= 60
            ? ('stable' as const)
            : ('needs_attention' as const),
      delta: this.deltaPercent(series[0] ?? average, average),
      direction,
      sparkline: series,
    };
  }

  private buildWaterMetric(series: number[]) {
    const average =
      series.reduce((sum, value) => sum + value, 0) /
      Math.max(series.length, 1);
    const roundedAverage = Number(average.toFixed(1));
    const direction = this.compareDirection(
      series[0] ?? roundedAverage,
      roundedAverage,
    );

    return {
      kind: 'water' as const,
      value: roundedAverage.toFixed(1),
      unit: 'L',
      status:
        roundedAverage >= 1.8
          ? ('good' as const)
          : roundedAverage >= 1.2
            ? ('stable' as const)
            : ('needs_attention' as const),
      delta: this.deltaNumber(series[0] ?? roundedAverage, roundedAverage, 1),
      direction,
      sparkline: series,
    };
  }

  private buildSleepMetric(series: number[]) {
    return {
      kind: 'sleep' as const,
      value: '--',
      unit: 'h',
      status: 'insufficient_data' as const,
      delta: '--',
      direction: 'flat' as const,
      sparkline: series,
    };
  }

  private buildScore(
    metrics: Array<{
      status: MetricStatus;
    }>,
  ) {
    const scoreParts = metrics.map((metric) => {
      switch (metric.status) {
        case 'good':
          return 35;
        case 'stable':
          return 25;
        case 'needs_attention':
          return 15;
        case 'insufficient_data':
          return 18;
      }
    });

    const value = Math.min(
      100,
      Math.max(
        0,
        scoreParts.reduce((sum, part) => sum + part, 0),
      ),
    );

    let status: MetricStatus = 'stable';
    if (value >= 85) {
      status = 'good';
    } else if (value < 65) {
      status = 'needs_attention';
    }

    return {
      value,
      maxValue: 100,
      status,
      summary: this.buildScoreSummary(metrics),
    };
  }

  private buildScoreSummary(
    metrics: Array<{
      kind?: string;
      status: MetricStatus;
    }>,
  ): string {
    const hasMedicationGood = metrics.some(
      (metric) => metric.kind === 'medication' && metric.status === 'good',
    );
    const hasWaterNeedsAttention = metrics.some(
      (metric) =>
        metric.kind === 'water' && metric.status === 'needs_attention',
    );
    const hasSleepInsufficient = metrics.some(
      (metric) =>
        metric.kind === 'sleep' && metric.status === 'insufficient_data',
    );

    const parts: string[] = [];
    if (hasMedicationGood) {
      parts.push('本周用药完成较稳');
    }
    if (hasWaterNeedsAttention) {
      parts.push('饮水仍有提升空间');
    }
    if (hasSleepInsufficient) {
      parts.push('睡眠数据暂不足');
    }

    return parts.length > 0 ? `${parts.join('，')}。` : '本周报告数据已更新。';
  }

  private buildFindings(
    medicationSeries: number[],
    waterSeries: number[],
    sleepMetric: { status: MetricStatus },
  ) {
    const findings: ReportDashboardDataDto['findings'] = [];

    const lowWaterDays = waterSeries.filter((value) => value < 1.5).length;
    if (lowWaterDays >= 4) {
      findings.push({
        kind: 'hydration',
        title: '饮水仍偏少',
        body: `近 7 天中有 ${String(lowWaterDays)} 天饮水低于 1.5L。`,
      });
    }

    const medicationStrongDays = medicationSeries.filter(
      (value) => value >= 80,
    ).length;
    if (medicationStrongDays >= 5) {
      findings.push({
        kind: 'medication',
        title: '用药执行较稳定',
        body: `近 7 天中有 ${String(medicationStrongDays)} 天用药完成率达到 80% 以上。`,
      });
    }

    if (sleepMetric.status === 'insufficient_data') {
      findings.push({
        kind: 'sleep',
        title: '睡眠数据不足',
        body: '当前还没有稳定的睡眠合同数据，暂不展示真实睡眠趋势。',
      });
    }

    return findings.slice(0, 3);
  }

  private buildPatterns(
    medicationSeries: number[],
    waterSeries: number[],
    sleepSeries: number[],
  ) {
    return [
      {
        kind: 'medication' as const,
        title: '用药依从性',
        status: medicationSeries.some((value) => value > 0)
          ? ('good' as const)
          : ('insufficient_data' as const),
        body: medicationSeries.some((value) => value > 0)
          ? '本周可见用药计划执行情况，适合继续保持固定节奏。'
          : '当前暂无足够用药计划数据来判断依从性趋势。',
        sparkline: medicationSeries,
      },
      {
        kind: 'hydration' as const,
        title: '饮水趋势',
        status:
          waterSeries.filter((value) => value >= 1.5).length >= 4
            ? ('stable' as const)
            : ('needs_attention' as const),
        body:
          waterSeries.filter((value) => value >= 1.5).length >= 4
            ? '本周饮水有一定连续性，但仍建议继续巩固。'
            : '近 7 天饮水连续性不足，建议先稳定日常补水节奏。',
        sparkline: waterSeries,
      },
      {
        kind: 'sleep' as const,
        title: '睡眠趋势',
        status: 'insufficient_data' as const,
        body: '睡眠合同尚未接入真实持久化数据，当前仅保留缺失状态。',
        sparkline: sleepSeries,
      },
    ];
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

  private compareDirection(
    firstValue: number,
    currentValue: number,
  ): MetricDirection {
    const delta = currentValue - firstValue;
    if (Math.abs(delta) < 0.01) {
      return 'flat';
    }
    return delta > 0 ? 'up' : 'down';
  }

  private deltaPercent(firstValue: number, currentValue: number): string {
    if (firstValue <= 0) {
      return '--';
    }
    const delta = Math.round(currentValue - firstValue);
    const sign = delta >= 0 ? '+' : '';
    return sign + delta.toString() + '%';
  }

  private deltaNumber(
    firstValue: number,
    currentValue: number,
    fractionDigits: number,
  ): string {
    const delta = Number((currentValue - firstValue).toFixed(fractionDigits));
    const sign = delta >= 0 ? '+' : '';
    return sign + delta.toFixed(fractionDigits);
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
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }

  private toDateString(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
