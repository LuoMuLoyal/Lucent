import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import type { TodayAnalysisContext } from './today-analysis-context.service';
import type { TodayAnalysisStructuredOutput } from './schemas/today-analysis.schema';
import type { TodayAnalysisPromptCopy } from './prompts/today-analysis.prompt';

@Injectable()
export class TodayAnalysisCopyService {
  constructor(private readonly i18n: I18nService) {}

  resolveLocale(language: string | undefined): string {
    const normalized = language?.trim().toLowerCase() ?? '';
    if (normalized.startsWith('zh')) {
      return 'zh-CN';
    }
    return 'en';
  }

  serviceUnavailable(locale: string): string {
    return this.i18n.t('today-analysis.service_unavailable', {
      lang: locale,
    });
  }

  summariesDisabled(locale: string): string {
    return this.i18n.t('today-analysis.summaries_disabled', {
      lang: locale,
    });
  }

  buildPromptCopy(locale: string): TodayAnalysisPromptCopy {
    const actionLabel = this.i18n.t('today-analysis.fallback.action_label', {
      lang: locale,
    });
    const languageLabel = locale === 'zh-CN' ? '中文' : 'English';

    return {
      userIntro: this.i18n.t('today-analysis.prompt.user_intro', {
        lang: locale,
        args: {
          languageLabel,
        },
      }),
      tone: this.i18n.t('today-analysis.prompt.tone', {
        lang: locale,
      }),
      actionLabelHint: this.i18n.t('today-analysis.prompt.action_label_hint', {
        lang: locale,
        args: {
          actionLabel,
        },
      }),
      factsLabel: this.i18n.t('today-analysis.prompt.facts_label', {
        lang: locale,
      }),
    };
  }

  buildFallback(
    context: TodayAnalysisContext,
    locale: string,
  ): TodayAnalysisStructuredOutput {
    const medicationPending = context.medication.pendingCount;
    const waterRemaining = context.water.remainingCount;
    const actionLabel = this.i18n.t('today-analysis.fallback.action_label', {
      lang: locale,
    });
    const confidenceNote = this.i18n.t(
      'today-analysis.fallback.confidence_note',
      {
        lang: locale,
      },
    );

    let summary = this.i18n.t('today-analysis.fallback.summary_default', {
      lang: locale,
    });
    if (medicationPending > 0 && waterRemaining > 0) {
      summary = this.i18n.t(
        'today-analysis.fallback.summary_medication_and_hydration',
        {
          lang: locale,
          args: {
            medicationPending,
            waterRemaining,
          },
        },
      );
    } else if (medicationPending > 0) {
      summary = this.i18n.t('today-analysis.fallback.summary_medication_only', {
        lang: locale,
        args: {
          medicationPending,
        },
      });
    } else if (waterRemaining > 0) {
      summary = this.i18n.t('today-analysis.fallback.summary_hydration_only', {
        lang: locale,
        args: {
          waterRemaining,
        },
      });
    }

    return {
      summary,
      bullets: [
        {
          kind: 'medication',
          text:
            medicationPending > 0
              ? this.i18n.t(
                  'today-analysis.fallback.bullet_medication_pending',
                  {
                    lang: locale,
                    args: {
                      medicationPending,
                    },
                  },
                )
              : this.i18n.t('today-analysis.fallback.bullet_medication_done', {
                  lang: locale,
                }),
        },
        {
          kind: 'hydration',
          text:
            waterRemaining > 0
              ? this.i18n.t(
                  'today-analysis.fallback.bullet_hydration_pending',
                  {
                    lang: locale,
                    args: {
                      waterRemaining,
                    },
                  },
                )
              : this.i18n.t('today-analysis.fallback.bullet_hydration_done', {
                  lang: locale,
                }),
        },
        {
          kind: 'sleep',
          text: this.i18n.t('today-analysis.fallback.bullet_sleep_missing', {
            lang: locale,
          }),
        },
      ],
      actionLabel,
      confidenceNote,
    };
  }
}
