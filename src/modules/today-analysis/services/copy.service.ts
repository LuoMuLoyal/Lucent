import { Injectable } from '@nestjs/common';
import { LocalizedCopyService } from '../../../common/services/localized-copy.service';
import type { TodayAnalysisContext } from './context.service';
import type { TodayAnalysisStructuredOutput } from '../schemas/analysis.schema';
import type { TodayAnalysisPromptCopy } from '../prompts/analysis.prompt';

@Injectable()
export class TodayAnalysisCopyService extends LocalizedCopyService<TodayAnalysisPromptCopy> {
  protected readonly scope = 'today-analysis';

  summariesDisabled(locale: string): string {
    return this.t(locale, 'summaries_disabled');
  }

  buildFallback(
    context: TodayAnalysisContext,
    locale: string,
  ): TodayAnalysisStructuredOutput {
    const medicationPending = context.medication.pendingCount;
    const waterRemaining = context.water.remainingCount;
    const actionLabel = this.t(locale, 'fallback.action_label');
    const action = this.t(locale, 'fallback.action');
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
      action,
      confidenceNote,
    };
  }
}
