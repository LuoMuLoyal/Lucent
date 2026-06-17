import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import {
  buildLocalizedAiPromptCopy,
  resolveAiLocale,
  translateAiScopedCopy,
} from '../../../common/ai/ai-copy';
import type { TodayAnalysisContext } from './today-analysis-context.service';
import type { TodayAnalysisStructuredOutput } from '../schemas/today-analysis.schema';
import type { TodayAnalysisPromptCopy } from '../prompts/today-analysis.prompt';

const TODAY_ANALYSIS_COPY_SCOPE = 'today-analysis';

@Injectable()
export class TodayAnalysisCopyService {
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

  buildPromptCopy(locale: string): TodayAnalysisPromptCopy {
    return buildLocalizedAiPromptCopy(
      this.i18n,
      TODAY_ANALYSIS_COPY_SCOPE,
      locale,
    );
  }

  buildFallback(
    context: TodayAnalysisContext,
    locale: string,
  ): TodayAnalysisStructuredOutput {
    const medicationPending = context.medication.pendingCount;
    const waterRemaining = context.water.remainingCount;
    const actionLabel = this.t(locale, 'fallback.action_label');
    const confidenceNote = this.t(locale, 'fallback.confidence_note');

    let summary = this.t(locale, 'fallback.summary_default');
    if (medicationPending > 0 && waterRemaining > 0) {
      summary = this.t(locale, 'fallback.summary_medication_and_hydration', {
        medicationPending,
        waterRemaining,
      });
    } else if (medicationPending > 0) {
      summary = this.t(locale, 'fallback.summary_medication_only', {
        medicationPending,
      });
    } else if (waterRemaining > 0) {
      summary = this.t(locale, 'fallback.summary_hydration_only', {
        waterRemaining,
      });
    }

    return {
      summary,
      bullets: [
        {
          kind: 'medication',
          text:
            medicationPending > 0
              ? this.t(locale, 'fallback.bullet_medication_pending', {
                  medicationPending,
                })
              : this.t(locale, 'fallback.bullet_medication_done'),
        },
        {
          kind: 'hydration',
          text:
            waterRemaining > 0
              ? this.t(locale, 'fallback.bullet_hydration_pending', {
                  waterRemaining,
                })
              : this.t(locale, 'fallback.bullet_hydration_done'),
        },
        {
          kind: 'sleep',
          text: this.t(locale, 'fallback.bullet_sleep_missing'),
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
      TODAY_ANALYSIS_COPY_SCOPE,
      locale,
      key,
      args,
    );
  }
}
