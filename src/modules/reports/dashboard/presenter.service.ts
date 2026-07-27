import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import type {
  ReportDashboardDataDto,
  ReportFindingDto,
  ReportPatternDto,
} from '../dto/report-dashboard-response.dto';

import type { ReportRange } from '../dto/report-dashboard-query.dto';
import type { MetricStatus } from './types';

@Injectable()
export class ReportsPresenterService {
  // ── Findings thresholds ──

  /** Daily water intake (L) below this is considered "low" for a day. */
  private static readonly LOW_WATER_THRESHOLD_LITERS = 1.5;
  /** Minimum number of low-hydration days (within the range) to trigger a "hydration low" finding. */
  private static readonly HYDRATION_LOW_DAYS_THRESHOLD = 4;
  /** Medication adherence % at or above this is considered "strong" for a day. */
  private static readonly MEDICATION_STRONG_ADHERENCE_PERCENT = 80;
  /** Minimum number of strong-adherence days (within the range) to trigger a "medication stable" finding. */
  private static readonly MEDICATION_STRONG_DAYS_THRESHOLD = 5;

  // ── Pattern thresholds ──

  /** Minimum number of days with water >= 1.5 L to show a "stable" hydration pattern. */
  private static readonly HYDRATION_STABLE_DAYS_THRESHOLD = 4;
  /** Water intake (L) at or above this counts toward the "stable" hydration day count. */
  private static readonly HYDRATION_STABLE_LITERS = 1.5;

  // ── Sleep pattern thresholds ──

  /** Average sleep hours at or above this is rated "good". */
  private static readonly SLEEP_GOOD_HOURS = 7;
  /** Average sleep hours at or above this (but below good) is rated "stable". */
  private static readonly SLEEP_STABLE_HOURS = 5;

  constructor(private readonly i18n: I18nService) {}

  buildScore(
    statuses: MetricStatus[],
    locale: string,
  ): ReportDashboardDataDto['score'] {
    const scoreParts = statuses.map((status) => {
      switch (status) {
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
      summary: this.buildScoreSummary(statuses, locale),
    };
  }

  buildFindings(
    input: {
      range: ReportRange;
      medicationSeries: number[];
      waterSeries: number[];
      sleepStatus: MetricStatus;
    },
    locale: string,
  ): ReportFindingDto[] {
    const findings: ReportFindingDto[] = [];

    const waterRecords = input.waterSeries.filter((value) => value > 0);
    const lowWaterDays = input.waterSeries.filter(
      (value) =>
        value > 0 && value < ReportsPresenterService.LOW_WATER_THRESHOLD_LITERS,
    ).length;
    if (
      waterRecords.length > 0 &&
      lowWaterDays >= ReportsPresenterService.HYDRATION_LOW_DAYS_THRESHOLD
    ) {
      findings.push({
        kind: 'hydration',
        title: this.i18n.t('reports-dashboard.findings.hydration_low_title', {
          lang: locale,
        }),
        body: this.i18n.t('reports-dashboard.findings.hydration_low_body', {
          lang: locale,
          args: {
            lowWaterDays: String(lowWaterDays),
            dayCount: String(waterRecords.length),
          },
        }),
      });
    }

    const medicationRecords = input.medicationSeries.filter(
      (value) => value > 0,
    );
    const medicationStrongDays = input.medicationSeries.filter(
      (value) =>
        value >= ReportsPresenterService.MEDICATION_STRONG_ADHERENCE_PERCENT,
    ).length;
    if (
      medicationRecords.length > 0 &&
      medicationStrongDays >=
        ReportsPresenterService.MEDICATION_STRONG_DAYS_THRESHOLD
    ) {
      findings.push({
        kind: 'medication',
        title: this.i18n.t(
          'reports-dashboard.findings.medication_stable_title',
          { lang: locale },
        ),
        body: this.i18n.t('reports-dashboard.findings.medication_stable_body', {
          lang: locale,
          args: {
            strongDays: String(medicationStrongDays),
            dayCount: String(medicationRecords.length),
          },
        }),
      });
    }

    if (input.sleepStatus === 'insufficient_data') {
      findings.push({
        kind: 'sleep',
        title: this.i18n.t(
          'reports-dashboard.findings.sleep_insufficient_title',
          { lang: locale },
        ),
        body: this.i18n.t(
          'reports-dashboard.findings.sleep_insufficient_body',
          { lang: locale },
        ),
      });
    }

    return findings.slice(0, 3);
  }

  buildPatterns(
    input: {
      range: ReportRange;
      medicationSeries: number[];
      waterSeries: number[];
      sleepSeries: number[];
    },
    locale: string,
  ): ReportPatternDto[] {
    const medicationActive = input.medicationSeries.some((value) => value > 0);
    const waterGood =
      input.waterSeries.filter(
        (value) => value >= ReportsPresenterService.HYDRATION_STABLE_LITERS,
      ).length >= ReportsPresenterService.HYDRATION_STABLE_DAYS_THRESHOLD;

    return [
      {
        kind: 'medication',
        title: this.i18n.t('reports-dashboard.patterns.medication_title', {
          lang: locale,
        }),
        status: medicationActive ? 'good' : 'insufficient_data',
        body: medicationActive
          ? this.i18n.t('reports-dashboard.patterns.medication_body_good', {
              lang: locale,
            })
          : this.i18n.t(
              'reports-dashboard.patterns.medication_body_insufficient',
              { lang: locale },
            ),
        sparkline: input.medicationSeries,
      },
      {
        kind: 'hydration',
        title: this.i18n.t('reports-dashboard.patterns.hydration_title', {
          lang: locale,
        }),
        status: waterGood ? 'stable' : 'needs_attention',
        body: waterGood
          ? this.i18n.t('reports-dashboard.patterns.hydration_body_stable', {
              lang: locale,
              args: {
                dayCount: String(this.dayCount(input.range)),
              },
            })
          : this.i18n.t('reports-dashboard.patterns.hydration_body_attention', {
              lang: locale,
              args: {
                dayCount: String(this.dayCount(input.range)),
              },
            }),
        sparkline: input.waterSeries,
      },
      {
        kind: 'sleep',
        title: this.i18n.t('reports-dashboard.patterns.sleep_title', {
          lang: locale,
        }),
        status: this.sleepPatternStatus(input.sleepSeries),
        body: this.buildSleepPatternBody(
          input.sleepSeries,
          input.range,
          locale,
        ),
        sparkline: input.sleepSeries,
      },
    ];
  }

  private sleepPatternStatus(sleepSeries: number[]): MetricStatus {
    const nonZeroDays = sleepSeries.filter((value) => value > 0);
    if (nonZeroDays.length === 0) return 'insufficient_data';
    const avg = nonZeroDays.reduce((sum, v) => sum + v, 0) / nonZeroDays.length;
    if (avg >= ReportsPresenterService.SLEEP_GOOD_HOURS) return 'good';
    if (avg >= ReportsPresenterService.SLEEP_STABLE_HOURS) return 'stable';
    return 'needs_attention';
  }

  private buildSleepPatternBody(
    sleepSeries: number[],
    range: ReportRange,
    locale: string,
  ): string {
    const status = this.sleepPatternStatus(sleepSeries);
    if (status === 'insufficient_data') {
      return this.i18n.t('reports-dashboard.patterns.sleep_body_insufficient', {
        lang: locale,
      });
    }
    const nonZeroDays = sleepSeries.filter((v) => v > 0);
    const avg = (
      nonZeroDays.reduce((sum, v) => sum + v, 0) / nonZeroDays.length
    ).toFixed(1);
    const bodyKey = `reports-dashboard.patterns.sleep_body_${status}`;
    return this.i18n.t(bodyKey, {
      lang: locale,
      args: {
        avgHours: avg,
        dayCount: String(this.dayCount(range)),
      },
    });
  }

  private buildScoreSummary(statuses: MetricStatus[], locale: string): string {
    const medicationStatus = statuses[0];
    const waterStatus = statuses[1];
    const sleepStatus = statuses[2];
    const parts: string[] = [];

    if (medicationStatus === 'good') {
      parts.push(
        this.i18n.t('reports-dashboard.score.part_medication_good', {
          lang: locale,
        }),
      );
    }
    if (waterStatus === 'needs_attention') {
      parts.push(
        this.i18n.t('reports-dashboard.score.part_hydration_attention', {
          lang: locale,
        }),
      );
    }
    if (sleepStatus === 'insufficient_data') {
      parts.push(
        this.i18n.t('reports-dashboard.score.part_sleep_insufficient', {
          lang: locale,
        }),
      );
    } else if (sleepStatus === 'good') {
      parts.push(
        this.i18n.t('reports-dashboard.score.part_sleep_good', {
          lang: locale,
        }),
      );
    } else if (sleepStatus === 'needs_attention') {
      parts.push(
        this.i18n.t('reports-dashboard.score.part_sleep_attention', {
          lang: locale,
        }),
      );
    }

    if (parts.length > 0) {
      const separator = locale.startsWith('zh') ? '，' : ', ';
      const ending = locale.startsWith('zh') ? '。' : '.';
      return parts.join(separator) + ending;
    }

    return this.i18n.t('reports-dashboard.score.default_summary', {
      lang: locale,
    });
  }

  private dayCount(range: ReportRange): number {
    return range === 'last_30_days' ? 30 : 7;
  }
}
