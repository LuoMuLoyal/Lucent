import { Injectable, Logger } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { now, nowIsoString, formatDateOnly } from '../../../common/helpers';
import type {
  SuggestionCandidate,
  RuleContext,
  SuggestionCardTone,
} from '../../today-suggestion/types';
import {
  SuggestionType,
  SuggestionLifecycleState,
  SuggestionFeedback,
} from '../../today-suggestion/types';
import type { SuggestionItemDto } from '../../today-suggestion/dto/suggestion-response.dto';
import type { TodaySuggestionsDataDto } from '../../today-suggestion/dto/suggestion-history.dto';
import { MedicationCollectorService } from './collectors/medication.service';
import { RecordCollectorService } from './collectors/record.service';
import { ProfileCollectorService } from './collectors/profile.service';
import { RegistryService } from './rules/registry.service';
import { ArbitrationService } from './arbitration/service';
import { SuppressionService } from './arbitration/suppression.service';
import { BaselineService } from './lifecycle/baseline.service';
import { LifecycleService } from './lifecycle/service';
import { EscalationService } from './notification/escalation.service';
import { SuggestionCacheService } from './cache/suggestion-cache.service';
import { SuggestionCopyService, SuggestionCopyQueueService } from './copy';
import type { CopyGenerationResult } from './copy';
import type { CopyJobData } from '../types';
import { getFallbackCopy } from '../constants';

/**
 * Main orchestrator for the Today suggestion engine.
 *
 * Pipeline:
 * 1. Collect signals from all collectors.
 * 2. Build RuleContext (baseline status, time of day).
 * 3. Run all registered rules against the signals.
 * 4. Filter & adjust candidates via feedback-driven suppression.
 * 5. Arbitrate candidates into primary / secondary / observations.
 * 6. Persist active suggestions to DB.
 * 7. Escalate eligible suggestions to notifications.
 * 8. Map to response DTOs.
 */
@Injectable()
export class SuggestionService {
  private readonly logger = new Logger(SuggestionService.name);

  constructor(
    private readonly medicationCollector: MedicationCollectorService,
    private readonly recordCollector: RecordCollectorService,
    private readonly profileCollector: ProfileCollectorService,
    private readonly registry: RegistryService,
    private readonly suppression: SuppressionService,
    private readonly arbitration: ArbitrationService,
    private readonly baseline: BaselineService,
    private readonly lifecycle: LifecycleService,
    private readonly escalation: EscalationService,
    private readonly cache: SuggestionCacheService,
    private readonly copyService: SuggestionCopyService,
    private readonly copyQueue: SuggestionCopyQueueService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Generates suggestions for the given user and date.
   */
  async generate(
    userId: string,
    date?: string,
    excludeIds?: string[],
    options?: {
      locale?: string;
    },
  ): Promise<TodaySuggestionsDataDto> {
    const targetDate = date ?? formatDateOnly(now());
    const generatedAt = nowIsoString();
    const excludeKey = SuggestionCacheService.buildExcludeKey(excludeIds);

    // 0. Check suggestion result cache
    const cachedResult = await this.cache.getSuggestions(
      userId,
      targetDate,
      excludeKey,
    );
    if (cachedResult != null) {
      return {
        generatedAt,
        primary: cachedResult.primary,
        secondary: cachedResult.secondary,
        observations: cachedResult.observations,
      };
    }

    // 1. Collect signals (use signal cache if available)
    let allSignals = await this.cache.getSignals(userId, targetDate);
    if (allSignals == null) {
      const [medicationSignals, recordSignals, profileSignals] =
        await Promise.all([
          this.medicationCollector.collect(userId, targetDate),
          this.recordCollector.collect(userId, targetDate),
          this.profileCollector.collect(userId, targetDate),
        ]);

      allSignals = [...medicationSignals, ...recordSignals, ...profileSignals];

      await this.cache.setSignals(userId, targetDate, allSignals);
    }

    // 2. Build rule context (use baseline cache if available)
    let baselineStatus = await this.cache.getBaselineStatus(userId);
    if (baselineStatus == null) {
      baselineStatus = await this.baseline.getBaselineStatus(userId);
      await this.cache.setBaselineStatus(userId, baselineStatus);
    }
    const context: RuleContext = {
      userId,
      date: targetDate,
      timeOfDay: RecordCollectorService.getTimeOfDay(),
      baselineStatus,
    };

    // 3. Run all rules
    const candidates: SuggestionCandidate[] = [];
    let degraded = false;
    for (const rule of this.registry.getAll()) {
      if (rule.isBaselineRequired && rule.baselineDimensions != null) {
        const allReady = rule.baselineDimensions.every(
          (dim) => baselineStatus.get(dim) === true,
        );
        if (!allReady) {
          continue;
        }
      }

      try {
        const candidate = rule.match(allSignals, context);
        if (candidate != null) {
          candidates.push(candidate);
        }
      } catch (error) {
        degraded = true;
        this.logger.error(
          `Rule ${rule.ruleId} threw an error: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    // 4. Filter & adjust candidates via feedback-driven suppression
    const { candidates: adjustedCandidates } =
      await this.suppression.filterAndAdjust(userId, candidates);

    // 5. Arbitrate
    const arbitrationResult = this.arbitration.arbitrate(adjustedCandidates);

    // 6. Generate AI copy for all candidates
    const locale = options?.locale ?? 'zh-CN';
    const allCandidates = [
      arbitrationResult.primary,
      ...arbitrationResult.secondary,
      ...arbitrationResult.observations,
    ].filter((c): c is SuggestionCandidate => c != null);

    const copyRequests: CopyJobData[] = allCandidates.map((c) => ({
      templateKey: c.copyGeneration.templateKey,
      params: c.copyGeneration.params,
      locale,
      tone: 'gentle',
      suggestionType: c.type,
      confidence: c.confidence,
      ruleId: c.ruleId,
      ...(c.subtype != null ? { subtype: c.subtype } : {}),
      evidence: c.evidence.map((e) => ({ ...e })),
    }));

    const copyResults = this.copyQueue.isConfigured
      ? await this.copyService.getOrEnqueueBatch(copyRequests, this.copyQueue)
      : await this.copyService.generateSyncBatch(copyRequests);

    // 7. Persist active suggestions
    await this.lifecycle.expireStaleSuggestions(userId, targetDate);

    const activeItems: SuggestionItemDto[] = [];

    if (arbitrationResult.primary != null) {
      const copy = this.resolveCopy(
        copyResults,
        arbitrationResult.primary.copyGeneration.templateKey,
        locale,
      );
      const id = await this.lifecycle.persistActive(
        userId,
        arbitrationResult.primary,
        targetDate,
        copy,
      );
      activeItems.push(
        this.toDto(
          id,
          arbitrationResult.primary,
          SuggestionLifecycleState.ACTIVE,
          copy,
          locale,
        ),
      );

      // 8. Escalate eligible primary suggestion to notification
      await this.escalation.escalateIfNeeded(
        userId,
        id,
        arbitrationResult.primary,
        targetDate,
        copy,
      );
    }

    for (const candidate of arbitrationResult.secondary) {
      const copy = this.resolveCopy(
        copyResults,
        candidate.copyGeneration.templateKey,
        locale,
      );
      const id = await this.lifecycle.persistActive(
        userId,
        candidate,
        targetDate,
        copy,
      );
      activeItems.push(
        this.toDto(
          id,
          candidate,
          SuggestionLifecycleState.ACTIVE,
          copy,
          locale,
        ),
      );
    }

    // 9. Map observations (not persisted — they're low priority)
    const observationDtos = arbitrationResult.observations.map((c, i) => {
      const copy = this.resolveCopy(
        copyResults,
        c.copyGeneration.templateKey,
        locale,
      );
      return this.toDto(
        `obs_${String(i)}`,
        c,
        SuggestionLifecycleState.ACTIVE,
        copy,
        locale,
      );
    });

    // Apply excludeIds filter
    const excludeSet = new Set(excludeIds ?? []);
    const firstActiveItem = activeItems[0];
    const filteredPrimary =
      firstActiveItem != null && !excludeSet.has(firstActiveItem.id)
        ? firstActiveItem
        : undefined;
    const filteredSecondary = activeItems
      .slice(1)
      .filter((s) => !excludeSet.has(s.id));
    const filteredObservations = observationDtos.filter(
      (s) => !excludeSet.has(s.id),
    );

    const result: TodaySuggestionsDataDto = {
      generatedAt,
      primary: filteredPrimary,
      secondary: filteredSecondary.length > 0 ? filteredSecondary : undefined,
      observations:
        filteredObservations.length > 0 ? filteredObservations : undefined,
      ...(degraded ? { degraded: true } : {}),
    };

    // Cache the result for subsequent requests
    await this.cache.setSuggestions(userId, targetDate, excludeKey, result);

    return result;
  }

  private resolveCopy(
    results: Map<string, CopyGenerationResult>,
    templateKey: string,
    locale: string,
  ): CopyGenerationResult {
    const result = results.get(templateKey);
    if (result != null) return result;

    this.logger.warn(
      `Missing copy result for template: ${templateKey}, using fallback`,
    );
    const fallback = getFallbackCopy(templateKey, locale);
    if (fallback) {
      return {
        title: fallback.title,
        reason: fallback.reason,
        boundary: fallback.boundary,
        actionLabel: fallback.actionLabel,
        aiGenerated: false,
        fromCache: false,
      };
    }
    this.logger.error(`No fallback copy found for template: ${templateKey}`);
    return {
      title: this.i18n.t('today-suggestion.fallback.title', { lang: locale }),
      reason: this.i18n.t('today-suggestion.fallback.reason', { lang: locale }),
      boundary: this.i18n.t('today-suggestion.fallback.boundary', {
        lang: locale,
      }),
      actionLabel: this.i18n.t('today-suggestion.fallback.action_label', {
        lang: locale,
      }),
      aiGenerated: false,
      fromCache: false,
    };
  }

  private toDto(
    id: string,
    candidate: SuggestionCandidate,
    lifecycleState: SuggestionLifecycleState = SuggestionLifecycleState.ACTIVE,
    copy: CopyGenerationResult,
    locale: string,
  ): SuggestionItemDto {
    const primaryAction = copy.actionLabel
      ? { ...candidate.primaryAction, label: copy.actionLabel }
      : {
          ...candidate.primaryAction,
          label: this.localizeActionLabel(
            candidate.primaryAction.label,
            locale,
          ),
        };

    return {
      id,
      type: candidate.type,
      cardTone: this.cardToneFor(candidate.type),
      icon: this.iconFor(candidate),
      title: copy.title,
      reason: copy.reason,
      evidence: candidate.evidence.map((e) => ({
        ...e,
        label: this.localizeEvidenceLabel(e.label, locale),
        value: this.localizeEvidenceValue(e.value, locale),
      })),
      boundary: copy.boundary,
      primaryAction,
      secondaryActions: candidate.secondaryActions?.map((a) => ({
        ...a,
        label: this.localizeActionLabel(a.label, locale),
      })),
      confidence: candidate.confidence,
      ruleId: candidate.ruleId,
      ruleVersion: candidate.ruleVersion,
      triggerType: candidate.triggerType,
      lifecycleState,
      notificationEligible: candidate.notificationEligible,
      feedbackOptions: this.feedbackOptionsFor(candidate.type),
      subtype: candidate.subtype,
    };
  }

  private cardToneFor(type: SuggestionType): SuggestionCardTone {
    switch (type) {
      case SuggestionType.CONFIRMED_RISK:
      case SuggestionType.COMPLIANCE:
        return 'urgent';
      case SuggestionType.TREND:
        return 'warning';
      case SuggestionType.BEHAVIOR_ADVICE:
        return 'soft';
      case SuggestionType.COVERAGE:
        return 'neutral';
      default:
        return 'soft';
    }
  }

  private iconFor(candidate: SuggestionCandidate): string {
    if (candidate.subtype != null) {
      const iconMap: Record<string, string> = {
        water: 'droplets',
        sleep: 'moon',
        symptom: 'activity',
        caffeine: 'coffee',
        profile: 'user',
        empty_today: 'clipboard',
      };
      const icon = iconMap[candidate.subtype];
      if (icon != null) {
        return icon;
      }
    }

    const typeIconMap: Record<SuggestionType, string> = {
      [SuggestionType.CONFIRMED_RISK]: 'alert-triangle',
      [SuggestionType.COMPLIANCE]: 'pill',
      [SuggestionType.TREND]: 'trending-up',
      [SuggestionType.BEHAVIOR_ADVICE]: 'lightbulb',
      [SuggestionType.COVERAGE]: 'info',
    };
    return typeIconMap[candidate.type];
  }

  private feedbackOptionsFor(type: SuggestionType): SuggestionFeedback[] {
    if (type === SuggestionType.COVERAGE) {
      return [SuggestionFeedback.ACCEPTED, SuggestionFeedback.LATER];
    }
    return [
      SuggestionFeedback.ACCEPTED,
      SuggestionFeedback.LATER,
      SuggestionFeedback.NOT_APPLICABLE,
      SuggestionFeedback.SUPPRESS,
    ];
  }

  private localizeEvidenceLabel(label: string, locale: string): string {
    return this.i18n.t(`today-suggestion.evidence.${label}`, { lang: locale });
  }

  private localizeEvidenceValue(value: string, locale: string): string {
    const key = `today-suggestion.evidence_value.${value}`;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- tsc infers unknown (variable assignment loses generic inference), ESLint infers string
    const translated = this.i18n.t(key, { lang: locale }) as string;
    // When i18n can't find the key, it returns the key path itself — fall back to raw value
    return translated === key ? value : translated;
  }

  private localizeActionLabel(label: string, locale: string): string {
    return this.i18n.t(`today-suggestion.action.${label}`, { lang: locale });
  }
}
