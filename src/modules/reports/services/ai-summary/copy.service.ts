import { Injectable } from '@nestjs/common';
import { LocalizedCopyService } from '../../../../common/services/localized-copy.service';
import type { ReportsAiSummaryContext } from './context.service';
import type { ReportSummaryStructuredOutput } from '../../schemas/report-summary.schema';
import type { ReportSummaryPromptCopy } from '../../prompts/report-summary.prompt';

@Injectable()
export class ReportsLlmSummaryCopyService extends LocalizedCopyService<ReportSummaryPromptCopy> {
  protected readonly scope = 'reports-ai-summary';

  summariesDisabled(locale: string): string {
    return this.t(locale, 'summaries_disabled');
  }

  buildFallback(
    context: ReportsAiSummaryContext,
    locale: string,
  ): ReportSummaryStructuredOutput {
    const dayCount = context.coverage.medication.totalDays;
    const allInsufficient =
      context.coverage.medication.trackedDays === 0 &&
      context.coverage.water.trackedDays === 0 &&
      context.coverage.sleep.trackedDays === 0;

    const disclaimer = this.t(locale, 'fallback.disclaimer', { dayCount });

    if (allInsufficient) {
      return {
        summary: this.t(locale, 'fallback.abstain', { dayCount }),
        coverage: {
          medication: context.coverage.medication,
          water: context.coverage.water,
          sleep: context.coverage.sleep,
        },
        observedPattern: null,
        lowRiskAction: null,
        disclaimer,
      };
    }

    const medicationMetric = context.metrics.find(
      (metric) => metric.kind === 'medication',
    );
    const waterMetric = context.metrics.find(
      (metric) => metric.kind === 'water',
    );

    const observedPattern = this.buildFallbackPattern(
      context,
      locale,
      medicationMetric,
      waterMetric,
    );

    const lowRiskAction = this.buildFallbackAction(
      context,
      locale,
      medicationMetric,
      waterMetric,
    );

    const summary = this.buildFallbackSummary(
      context,
      locale,
      dayCount,
      medicationMetric,
      waterMetric,
    );

    return {
      summary,
      coverage: {
        medication: context.coverage.medication,
        water: context.coverage.water,
        sleep: context.coverage.sleep,
      },
      observedPattern,
      lowRiskAction,
      disclaimer,
    };
  }

  private buildFallbackPattern(
    context: ReportsAiSummaryContext,
    locale: string,
    medicationMetric: { status: string; value: string } | undefined,
    _waterMetric: { status: string; value: string } | undefined,
  ): ReportSummaryStructuredOutput['observedPattern'] {
    const medicationTrackedDays = context.coverage.medication.trackedDays;

    if (medicationTrackedDays > 0 && medicationMetric) {
      if (medicationMetric.status === 'good') {
        return {
          kind: 'medication',
          text: this.t(locale, 'fallback.pattern_medication_good', {
            trackedDays: medicationTrackedDays,
            value: medicationMetric.value,
          }),
          source: 'reminder_plan',
        };
      }
      if (medicationMetric.status === 'needs_attention') {
        return {
          kind: 'medication',
          text: this.t(locale, 'fallback.pattern_medication_attention', {
            trackedDays: medicationTrackedDays,
            value: medicationMetric.value,
          }),
          source: 'reminder_plan',
        };
      }
    }

    const waterTrackedDays = context.coverage.water.trackedDays;
    if (waterTrackedDays > 0 && _waterMetric) {
      return {
        kind: 'hydration',
        text: this.t(locale, 'fallback.pattern_hydration', {
          trackedDays: waterTrackedDays,
          value: _waterMetric.value,
        }),
        source: 'daily_record',
      };
    }

    return null;
  }

  private buildFallbackAction(
    _context: ReportsAiSummaryContext,
    locale: string,
    medicationMetric: { status: string } | undefined,
    waterMetric: { status: string; value: string } | undefined,
  ): ReportSummaryStructuredOutput['lowRiskAction'] {
    const label = this.t(locale, 'fallback.action_label');

    if (waterMetric && waterMetric.status !== 'insufficient_data') {
      return {
        label,
        text: this.t(locale, 'fallback.action_hydration'),
      };
    }

    if (medicationMetric && medicationMetric.status !== 'insufficient_data') {
      return {
        label,
        text: this.t(locale, 'fallback.action_logging'),
      };
    }

    return null;
  }

  private buildFallbackSummary(
    _context: ReportsAiSummaryContext,
    locale: string,
    dayCount: number,
    medicationMetric: { status: string; value: string } | undefined,
    waterMetric: { status: string; value: string } | undefined,
  ): string {
    if (
      medicationMetric?.status === 'needs_attention' ||
      waterMetric?.status === 'needs_attention'
    ) {
      return this.t(locale, 'fallback.summary_needs_attention', {
        dayCount,
        medicationValue: medicationMetric?.value ?? '--',
        waterValue: waterMetric?.value ?? '--',
      });
    }

    if (medicationMetric?.status === 'good') {
      return this.t(locale, 'fallback.summary_stable', {
        dayCount,
      });
    }

    return this.t(locale, 'fallback.summary_default', {
      dayCount,
    });
  }
}
