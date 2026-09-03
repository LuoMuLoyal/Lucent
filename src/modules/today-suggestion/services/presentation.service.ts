import { Injectable, Logger } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import type { SuggestionCandidate } from '../types/candidate.types.js';
import {
  SuggestionType,
  type SuggestionCardTone,
  SuggestionLifecycleState,
  SuggestionFeedback,
} from '../types/suggestion.types.js';
import type { SuggestionItemDto } from '../dto/suggestion-response.dto.js';
import type { TodaySuggestionsDataDto } from '../dto/suggestion-history.dto.js';
import type { CopyJobData } from '../types/copy-generation.types.js';
import { SuggestionCacheService } from './cache/suggestion-cache.service.js';
import {
  SuggestionCopyService,
  type CopyGenerationResult,
} from './copy/writer.service.js';
import { SuggestionCopyQueueService } from './copy/queue.service.js';
import { getFallbackCopy } from '../constants/copy-fallback.js';

/**
 * Handles the "presentation" half of the suggestion engine:
 * copy generation, cache management, and DTO mapping.
 *
 * Extracted from SuggestionService to reduce orchestrator complexity.
 */
@Injectable()
export class SuggestionPresentationService {
  private readonly logger = new Logger(SuggestionPresentationService.name);

  constructor(
    private readonly copyService: SuggestionCopyService,
    private readonly copyQueue: SuggestionCopyQueueService,
    private readonly cache: SuggestionCacheService,
    private readonly i18n: I18nService,
  ) {}

  // ─── Suggestion result cache ───

  /** Returns cached suggestion result if available. */
  async getCachedResult(
    userId: string,
    date: string,
    excludeKey: string,
  ): Promise<TodaySuggestionsDataDto | undefined> {
    return this.cache.getSuggestions(userId, date, excludeKey);
  }

  /** Stores suggestion result in cache. */
  async cacheResult(
    userId: string,
    date: string,
    excludeKey: string,
    result: TodaySuggestionsDataDto,
  ): Promise<void> {
    await this.cache.setSuggestions(userId, date, excludeKey, result);
  }

  // ─── Copy generation ───

  /**
   * Generates AI copy for all candidates in batch.
   * Uses the queue when configured, otherwise falls back to synchronous generation.
   */
  async generateCopy(
    candidates: SuggestionCandidate[],
    locale: string,
  ): Promise<Map<string, CopyGenerationResult>> {
    const copyRequests: CopyJobData[] = candidates.map((c) => ({
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

    return this.copyQueue.isConfigured
      ? await this.copyService.getOrEnqueueBatch(copyRequests, this.copyQueue)
      : await this.copyService.generateSyncBatch(copyRequests);
  }

  /**
   * Resolves copy for a candidate from the batch results map.
   * Falls back to template fallback or i18n defaults when no result is found.
   */
  resolveCopy(
    results: Map<string, CopyGenerationResult>,
    templateKey: string,
    params: Record<string, string | number>,
    locale: string,
  ): CopyGenerationResult {
    const resultKey = SuggestionCopyService.buildResultKey(templateKey, params);
    const result = results.get(resultKey);
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
      reason: this.i18n.t('today-suggestion.fallback.reason', {
        lang: locale,
      }),
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

  // ─── DTO mapping ───

  /** Maps a candidate + copy to a response DTO. */
  toDto(
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
        value: this.localizeEvidenceValue(e.value, locale, e.args),
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

  // ─── Private DTO helpers ───

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

  private localizeEvidenceValue(
    value: string,
    locale: string,
    args?: Record<string, string | number>,
  ): string {
    const key = `today-suggestion.evidence_value.${value}`;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- tsc infers unknown (variable assignment loses generic inference), ESLint infers string
    const translated = this.i18n.t(
      key,
      args != null ? { lang: locale, args } : { lang: locale },
    ) as string;
    // When i18n can't find the key, it returns the key path itself — fall back to raw value
    return translated === key ? value : translated;
  }

  private localizeActionLabel(label: string, locale: string): string {
    return this.i18n.t(`today-suggestion.action.${label}`, { lang: locale });
  }
}
