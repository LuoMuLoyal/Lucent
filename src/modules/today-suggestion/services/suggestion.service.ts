import { Injectable, Logger } from '@nestjs/common';
import {
  now,
  nowIsoString,
  formatDateOnly,
} from '../../../common/helpers/date-time.utils';
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
import { SuggestionCopyService, type CopyGenerationRequest } from './copy';

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

    const copyRequests: CopyGenerationRequest[] = allCandidates.map((c) => ({
      templateKey: c.copyGeneration.templateKey,
      params: c.copyGeneration.params,
      locale,
      tone: 'gentle',
    }));

    const copyResults = await this.copyService.generateBatch(copyRequests);

    // 7. Persist active suggestions
    await this.lifecycle.expireStaleSuggestions(userId, targetDate);

    const activeItems: SuggestionItemDto[] = [];

    if (arbitrationResult.primary != null) {
      const id = await this.lifecycle.persistActive(
        userId,
        arbitrationResult.primary,
        targetDate,
      );
      const copy = copyResults.get(
        arbitrationResult.primary.copyGeneration.templateKey,
      );
      activeItems.push(
        this.toDto(
          id,
          arbitrationResult.primary,
          SuggestionLifecycleState.ACTIVE,
          copy,
        ),
      );

      // 8. Escalate eligible primary suggestion to notification
      await this.escalation.escalateIfNeeded(
        userId,
        id,
        arbitrationResult.primary,
        targetDate,
      );
    }

    for (const candidate of arbitrationResult.secondary) {
      const id = await this.lifecycle.persistActive(
        userId,
        candidate,
        targetDate,
      );
      const copy = copyResults.get(candidate.copyGeneration.templateKey);
      activeItems.push(
        this.toDto(id, candidate, SuggestionLifecycleState.ACTIVE, copy),
      );
    }

    // 9. Map observations (not persisted — they're low priority)
    const observationDtos = arbitrationResult.observations.map((c, i) => {
      const copy = copyResults.get(c.copyGeneration.templateKey);
      return this.toDto(
        `obs_${String(i)}`,
        c,
        SuggestionLifecycleState.ACTIVE,
        copy,
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
    };

    // Cache the result for subsequent requests
    await this.cache.setSuggestions(userId, targetDate, excludeKey, result);

    return result;
  }

  private toDto(
    id: string,
    candidate: SuggestionCandidate,
    lifecycleState: SuggestionLifecycleState = SuggestionLifecycleState.ACTIVE,
    copy?: {
      title: string;
      reason: string;
      boundary: string;
      actionLabel: string;
    },
  ): SuggestionItemDto {
    // Use AI-generated copy if available, otherwise fall back to rule-provided copy
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Fallback during migration
    const title = copy?.title ?? candidate.title;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Fallback during migration
    const reason = copy?.reason ?? candidate.reason;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Fallback during migration
    const boundary = copy?.boundary ?? candidate.boundary;
    const primaryAction = copy?.actionLabel
      ? { ...candidate.primaryAction, label: copy.actionLabel }
      : { ...candidate.primaryAction };

    return {
      id,
      type: candidate.type,
      cardTone: this.cardToneFor(candidate.type),
      icon: this.iconFor(candidate),
      title,
      reason,
      evidence: candidate.evidence.map((e) => ({ ...e })),
      boundary,
      primaryAction,
      secondaryActions: candidate.secondaryActions?.map((a) => ({ ...a })),
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
}
