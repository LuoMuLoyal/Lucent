import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import type {
  ReportFindingDto,
  ReportPatternDto,
} from '../dto/report-dashboard-response.dto';

import type { ReportRange } from '../dto/report-dashboard-query.dto';
import type { MetricStatus } from './metrics.types';

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

    const waterRecords = input.waterSeries;
    const lowWaterDays = input.waterSeries.filter(
      (value) => value < ReportsPresenterService.LOW_WATER_THRESHOLD_LITERS,
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
    const waterObservedDays = input.waterSeries;
    const waterGood =
      waterObservedDays.filter(
        (value) => value >= ReportsPresenterService.HYDRATION_STABLE_LITERS,
      ).length >= ReportsPresenterService.HYDRATION_STABLE_DAYS_THRESHOLD;
    const waterStatus: MetricStatus =
      waterObservedDays.length === 0
        ? 'insufficient_data'
        : waterGood
          ? 'stable'
          : 'needs_attention';

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
        status: waterStatus,
        body:
          waterStatus === 'insufficient_data'
            ? this.i18n.t(
                'reports-dashboard.patterns.hydration_body_insufficient',
                { lang: locale },
              )
            : waterGood
              ? this.i18n.t(
                  'reports-dashboard.patterns.hydration_body_stable',
                  {
                    lang: locale,
                    args: {
                      dayCount: String(this.dayCount(input.range)),
                    },
                  },
                )
              : this.i18n.t(
                  'reports-dashboard.patterns.hydration_body_attention',
                  {
                    lang: locale,
                    args: {
                      dayCount: String(this.dayCount(input.range)),
                    },
                  },
                ),
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

  private dayCount(range: ReportRange): number {
    return range === 'last_30_days' ? 30 : 7;
  }
}
