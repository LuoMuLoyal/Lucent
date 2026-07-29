import { Injectable } from '@nestjs/common';
import { now, nowIsoString, formatDateOnly } from '../../../common';
import type { SuggestionCandidate } from '../types/candidate.types';
import { SuggestionLifecycleState } from '../types/suggestion.types';
import type { SuggestionItemDto } from '../../today-suggestion/dto/suggestion-response.dto';
import type { TodaySuggestionsDataDto } from '../../today-suggestion/dto/suggestion-history.dto';
import { SuggestionPipelineService } from './pipeline.service';
import { SuggestionPresentationService } from './presentation.service';
import { LifecycleService } from './lifecycle/service';
import { EscalationService } from './notification/escalation.service';
import { SuggestionCacheService } from './cache/suggestion-cache.service';

/**
 * Main orchestrator for the Today suggestion engine.
 *
 * Delegates to:
 * - {@link SuggestionPipelineService} for collect → rules → arbitrate
 * - {@link SuggestionPresentationService} for copy + cache + DTO mapping
 * - {@link LifecycleService} for persist + expire
 * - {@link EscalationService} for notification escalation
 */
@Injectable()
export class SuggestionService {
  constructor(
    private readonly pipeline: SuggestionPipelineService,
    private readonly presentation: SuggestionPresentationService,
    private readonly lifecycle: LifecycleService,
    private readonly escalation: EscalationService,
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
    const locale = options?.locale ?? 'zh-CN';

    // 0. Check suggestion result cache
    const cachedResult = await this.presentation.getCachedResult(
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

    // 1. Pipeline: collect signals → run rules → suppress → arbitrate
    const { arbitrationResult, degraded } = await this.pipeline.run(
      userId,
      targetDate,
    );

    // 2. Generate AI copy for all candidates
    const allCandidates = [
      arbitrationResult.primary,
      ...arbitrationResult.secondary,
      ...arbitrationResult.observations,
    ].filter((c): c is SuggestionCandidate => c != null);

    const copyResults = await this.presentation.generateCopy(
      allCandidates,
      locale,
    );

    // 3. Persist active suggestions (expire stale first)
    await this.lifecycle.expireStaleSuggestions(userId, targetDate);

    let primaryItem: SuggestionItemDto | undefined;
    const secondaryItems: SuggestionItemDto[] = [];

    if (arbitrationResult.primary != null) {
      const copy = this.presentation.resolveCopy(
        copyResults,
        arbitrationResult.primary.copyGeneration.templateKey,
        arbitrationResult.primary.copyGeneration.params,
        locale,
      );
      const id = await this.lifecycle.persistActive(
        userId,
        arbitrationResult.primary,
        targetDate,
        copy,
        locale,
      );
      primaryItem = this.presentation.toDto(
        id,
        arbitrationResult.primary,
        SuggestionLifecycleState.ACTIVE,
        copy,
        locale,
      );

      // 4. Escalate eligible primary suggestion to notification
      await this.escalation.escalateIfNeeded(
        userId,
        id,
        arbitrationResult.primary,
        targetDate,
        copy,
      );
    }

    for (const candidate of arbitrationResult.secondary) {
      const copy = this.presentation.resolveCopy(
        copyResults,
        candidate.copyGeneration.templateKey,
        candidate.copyGeneration.params,
        locale,
      );
      const id = await this.lifecycle.persistActive(
        userId,
        candidate,
        targetDate,
        copy,
        locale,
      );
      secondaryItems.push(
        this.presentation.toDto(
          id,
          candidate,
          SuggestionLifecycleState.ACTIVE,
          copy,
          locale,
        ),
      );
    }

    // 5. Map observations (not persisted — they're low priority)
    const observationDtos = arbitrationResult.observations.map((c, i) => {
      const copy = this.presentation.resolveCopy(
        copyResults,
        c.copyGeneration.templateKey,
        c.copyGeneration.params,
        locale,
      );
      return this.presentation.toDto(
        `obs_${String(i)}`,
        c,
        SuggestionLifecycleState.ACTIVE,
        copy,
        locale,
      );
    });

    // 6. Apply excludeIds filter
    const excludeSet = new Set(excludeIds ?? []);
    const filteredPrimary =
      primaryItem != null && !excludeSet.has(primaryItem.id)
        ? primaryItem
        : undefined;
    const filteredSecondary = secondaryItems.filter(
      (s) => !excludeSet.has(s.id),
    );
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

    // 7. Cache the result for subsequent requests
    await this.presentation.cacheResult(userId, targetDate, excludeKey, result);

    return result;
  }
}
