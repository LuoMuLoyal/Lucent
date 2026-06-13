import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import {
  buildLocalizedAiPromptCopy,
  resolveAiLocale,
  translateAiScopedCopy,
} from '../../common/ai/ai-copy';
import type { ReportsAiSummaryContext } from './reports-ai-summary-context.service';
import { REPORT_RANGE_LAST_30_DAYS } from './dto';
import type { ReportSummaryStructuredOutput } from './schemas/report-summary.schema';
import type { ReportSummaryPromptCopy } from './prompts/report-summary.prompt';

const REPORTS_AI_SUMMARY_COPY_SCOPE = 'reports-ai-summary';

@Injectable()
export class ReportsAiSummaryCopyService {
  constructor(private readonly i18n: I18nService) {}

  resolveLocale(language: string | undefined): string {
    return resolveAiLocale(language);
  }

  serviceUnavailable(locale: string): string {
    return this.t(locale, 'service_unavailable');
  }

  summariesDisabled(locale: string): string {
    return this.t(locale, 'summaries_disabled');
  }

  buildPromptCopy(locale: string): ReportSummaryPromptCopy {
    return buildLocalizedAiPromptCopy(
      this.i18n,
      REPORTS_AI_SUMMARY_COPY_SCOPE,
      locale,
    );
  }

  buildFallback(
    context: ReportsAiSummaryContext,
    locale: string,
  ): ReportSummaryStructuredOutput {
    const medicationMetric = context.metrics.find(
      (metric) => metric.kind === 'medication',
    );
    const waterMetric = context.metrics.find(
      (metric) => metric.kind === 'water',
    );
    const sleepTrackedDays = context.dataQuality.sleepTrackedDays;
    const medicationTrackedDays = context.dataQuality.medicationTrackedDays;
    const waterTrackedDays = context.dataQuality.waterTrackedDays;
    const dayCount = this.dayCount(context.range);
    const actionLabel = this.t(locale, 'fallback.action_label');
    const confidenceNote = this.t(locale, 'fallback.confidence_note', {
      dayCount,
    });

    let summary = this.t(locale, 'fallback.summary_default', {
      dayCount,
    });
    if (
      medicationMetric?.status === 'needs_attention' ||
      waterMetric?.status === 'needs_attention'
    ) {
      summary = this.t(locale, 'fallback.summary_needs_attention', {
        dayCount,
        medicationValue: medicationMetric?.value ?? '--',
        waterValue: waterMetric?.value ?? '--',
      });
    } else if (medicationMetric?.status === 'good') {
      summary = this.t(locale, 'fallback.summary_stable', {
        dayCount,
      });
    }

    return {
      summary,
      bullets: [
        {
          kind: 'medication',
          text: this.t(
            locale,
            medicationTrackedDays > 0
              ? 'fallback.bullet_medication_tracked'
              : 'fallback.bullet_medication_missing',
            {
              dayCount,
              medicationTrackedDays,
              medicationValue: medicationMetric?.value ?? '--',
            },
          ),
        },
        {
          kind: 'hydration',
          text: this.t(
            locale,
            waterTrackedDays > 0
              ? 'fallback.bullet_hydration_tracked'
              : 'fallback.bullet_hydration_missing',
            {
              dayCount,
              waterTrackedDays,
              waterValue: waterMetric?.value ?? '--',
            },
          ),
        },
        {
          kind: 'sleep',
          text: this.t(
            locale,
            sleepTrackedDays > 0
              ? 'fallback.bullet_sleep_tracked'
              : 'fallback.bullet_sleep_missing',
            {
              dayCount,
              sleepTrackedDays,
            },
          ),
        },
      ],
      actionLabel,
      confidenceNote,
    };
  }

  private t(
    locale: string,
    key: string,
    args?: Record<string, string | number>,
  ): string {
    return translateAiScopedCopy(
      this.i18n,
      REPORTS_AI_SUMMARY_COPY_SCOPE,
      locale,
      key,
      args,
    );
  }

  private dayCount(range: ReportsAiSummaryContext['range']): number {
    return range === REPORT_RANGE_LAST_30_DAYS ? 30 : 7;
  }
}
