import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import type { ReportsAiSummaryContext } from './reports-ai-summary-context.service';
import { REPORT_RANGE_LAST_30_DAYS } from './dto';
import type { ReportSummaryStructuredOutput } from './schemas/report-summary.schema';
import type { ReportSummaryPromptCopy } from './prompts/report-summary.prompt';

@Injectable()
export class ReportsAiSummaryCopyService {
  constructor(private readonly i18n: I18nService) {}

  resolveLocale(language: string | undefined): string {
    const normalized = language?.trim().toLowerCase() ?? '';
    if (normalized.startsWith('zh')) {
      return 'zh-CN';
    }
    return 'en';
  }

  serviceUnavailable(locale: string): string {
    return this.i18n.t('reports-ai-summary.service_unavailable', {
      lang: locale,
    });
  }

  summariesDisabled(locale: string): string {
    return this.i18n.t('reports-ai-summary.summaries_disabled', {
      lang: locale,
    });
  }

  buildPromptCopy(locale: string): ReportSummaryPromptCopy {
    const actionLabel = this.i18n.t(
      'reports-ai-summary.fallback.action_label',
      {
        lang: locale,
      },
    );
    const languageLabel = locale === 'zh-CN' ? '中文' : 'English';

    return {
      userIntro: this.i18n.t('reports-ai-summary.prompt.user_intro', {
        lang: locale,
        args: {
          languageLabel,
        },
      }),
      tone: this.i18n.t('reports-ai-summary.prompt.tone', {
        lang: locale,
      }),
      actionLabelHint: this.i18n.t(
        'reports-ai-summary.prompt.action_label_hint',
        {
          lang: locale,
          args: {
            actionLabel,
          },
        },
      ),
      factsLabel: this.i18n.t('reports-ai-summary.prompt.facts_label', {
        lang: locale,
      }),
    };
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
    const actionLabel = this.i18n.t(
      'reports-ai-summary.fallback.action_label',
      {
        lang: locale,
      },
    );
    const confidenceNote = this.i18n.t(
      'reports-ai-summary.fallback.confidence_note',
      {
        lang: locale,
        args: {
          dayCount: String(this.dayCount(context.range)),
        },
      },
    );

    let summary = this.i18n.t('reports-ai-summary.fallback.summary_default', {
      lang: locale,
      args: {
        dayCount: String(this.dayCount(context.range)),
      },
    });
    if (
      medicationMetric?.status === 'needs_attention' ||
      waterMetric?.status === 'needs_attention'
    ) {
      summary = this.i18n.t(
        'reports-ai-summary.fallback.summary_needs_attention',
        {
          lang: locale,
          args: {
            dayCount: String(this.dayCount(context.range)),
            medicationValue: medicationMetric?.value ?? '--',
            waterValue: waterMetric?.value ?? '--',
          },
        },
      );
    } else if (medicationMetric?.status === 'good') {
      summary = this.i18n.t('reports-ai-summary.fallback.summary_stable', {
        lang: locale,
        args: {
          dayCount: String(this.dayCount(context.range)),
        },
      });
    }

    return {
      summary,
      bullets: [
        {
          kind: 'medication',
          text: this.i18n.t(
            medicationTrackedDays > 0
              ? 'reports-ai-summary.fallback.bullet_medication_tracked'
              : 'reports-ai-summary.fallback.bullet_medication_missing',
            {
              lang: locale,
              args: {
                dayCount: String(this.dayCount(context.range)),
                medicationTrackedDays,
                medicationValue: medicationMetric?.value ?? '--',
              },
            },
          ),
        },
        {
          kind: 'hydration',
          text: this.i18n.t(
            waterTrackedDays > 0
              ? 'reports-ai-summary.fallback.bullet_hydration_tracked'
              : 'reports-ai-summary.fallback.bullet_hydration_missing',
            {
              lang: locale,
              args: {
                dayCount: String(this.dayCount(context.range)),
                waterTrackedDays,
                waterValue: waterMetric?.value ?? '--',
              },
            },
          ),
        },
        {
          kind: 'sleep',
          text: this.i18n.t(
            sleepTrackedDays > 0
              ? 'reports-ai-summary.fallback.bullet_sleep_tracked'
              : 'reports-ai-summary.fallback.bullet_sleep_missing',
            {
              lang: locale,
              args: {
                dayCount: String(this.dayCount(context.range)),
                sleepTrackedDays,
              },
            },
          ),
        },
      ],
      actionLabel,
      confidenceNote,
    };
  }

  private dayCount(range: ReportsAiSummaryContext['range']): number {
    return range === REPORT_RANGE_LAST_30_DAYS ? 30 : 7;
  }
}
