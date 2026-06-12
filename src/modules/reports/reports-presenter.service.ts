import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import type {
  ReportDashboardDataDto,
  ReportFindingDto,
  ReportPatternDto,
} from './dto';
import type { MetricStatus } from './reports.types';

@Injectable()
export class ReportsPresenterService {
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
      medicationSeries: number[];
      waterSeries: number[];
      sleepStatus: MetricStatus;
    },
    locale: string,
  ): ReportFindingDto[] {
    const findings: ReportFindingDto[] = [];

    const lowWaterDays = input.waterSeries.filter(
      (value) => value < 1.5,
    ).length;
    if (lowWaterDays >= 4) {
      findings.push({
        kind: 'hydration',
        title: this.i18n.t('reports-dashboard.findings.hydration_low_title', {
          lang: locale,
        }),
        body: this.i18n.t('reports-dashboard.findings.hydration_low_body', {
          lang: locale,
          args: { lowWaterDays: String(lowWaterDays) },
        }),
      });
    }

    const medicationStrongDays = input.medicationSeries.filter(
      (value) => value >= 80,
    ).length;
    if (medicationStrongDays >= 5) {
      findings.push({
        kind: 'medication',
        title: this.i18n.t(
          'reports-dashboard.findings.medication_stable_title',
          { lang: locale },
        ),
        body: this.i18n.t('reports-dashboard.findings.medication_stable_body', {
          lang: locale,
          args: { strongDays: String(medicationStrongDays) },
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
      medicationSeries: number[];
      waterSeries: number[];
      sleepSeries: number[];
    },
    locale: string,
  ): ReportPatternDto[] {
    const medicationActive = input.medicationSeries.some((value) => value > 0);
    const waterGood =
      input.waterSeries.filter((value) => value >= 1.5).length >= 4;

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
            })
          : this.i18n.t('reports-dashboard.patterns.hydration_body_attention', {
              lang: locale,
            }),
        sparkline: input.waterSeries,
      },
      {
        kind: 'sleep',
        title: this.i18n.t('reports-dashboard.patterns.sleep_title', {
          lang: locale,
        }),
        status: 'insufficient_data',
        body: this.i18n.t(
          'reports-dashboard.patterns.sleep_body_insufficient',
          { lang: locale },
        ),
        sparkline: input.sleepSeries,
      },
    ];
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
}
