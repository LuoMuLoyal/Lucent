import { Injectable } from '@nestjs/common';
import { now, nowIsoString, formatDateOnly } from '../../../common';
import type { SuggestionCandidate } from '../types/candidate.types';
import { SuggestionLifecycleState } from '../types/suggestion.types';
import type { SuggestionItemDto } from '../../today-suggestion/dto/suggestion-response.dto';
import type { TodaySuggestionsDataDto } from '../../today-suggestion/dto/suggestion-history.dto';
import { SuggestionPipelineService } from './pipeline.service';
import { SuggestionPresentationService } from './presentation.service';
import { LifecycleService } from './lifecycle/manager.service';
import { EscalationService } from './notification/escalation.service';
import { SuggestionCacheService } from './cache/suggestion-cache.service';
import { MaterializationStore } from './materialization/store.service';
import type { MaterializationStatusView } from '../types/materialization.types';
import type { SuggestionSignal } from '../types/signal.types';

export interface SuggestionRecomputeOptions {
  locale?: string;
  sourceVersion?: number;
  onSuccessfulRecompute?: (signals: SuggestionSignal[]) => Promise<void>;
}

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
    private readonly materializationStore: MaterializationStore,
  ) {}

  /**
   * Reads the current materialization without starting a computation.
   */
  async readCurrent(
    userId: string,
    date?: string,
    excludeIds?: string[],
    _options?: { locale?: string },
  ): Promise<TodaySuggestionsDataDto> {
    const targetDate = date ?? formatDateOnly(now());
    const status = await this.materializationStore.readStatus(
      userId,
      targetDate,
    );
    const metadata = this.materializationMetadata(status);
    if (status.status === 'empty') {
      return {
        generatedAt: nowIsoString(),
        secondary: undefined,
        observations: undefined,
        ...metadata,
      };
    }

    const cachedResult = await this.presentation.getCachedResult(
      userId,
      targetDate,
      SuggestionCacheService.buildExcludeKey(excludeIds),
    );
    if (
      cachedResult == null ||
      cachedResult.sourceVersion !== status.computedVersion
    ) {
      const persisted = await this.lifecycle.getActiveSuggestions(
        userId,
        targetDate,
        status.computedVersion,
      );
      const excluded = new Set(excludeIds ?? []);
      const current = persisted.filter((item) => !excluded.has(item.id));
      const [primary, ...secondary] = current;
      return {
        generatedAt: status.computedAt?.toISOString() ?? nowIsoString(),
        primary,
        secondary,
        observations: [],
        ...metadata,
      };
    }

    return {
      generatedAt: cachedResult.generatedAt,
      primary: cachedResult.primary,
      secondary: cachedResult.secondary,
      observations: cachedResult.observations,
      ...(cachedResult.degraded ? { degraded: true } : {}),
      ...metadata,
    };
  }

  /**
   * Performs a full suggestion recompute for the background worker.
   */
  async recompute(
    userId: string,
    date?: string,
    excludeIds?: string[],
    options?: SuggestionRecomputeOptions,
  ): Promise<TodaySuggestionsDataDto> {
    const targetDate = date ?? formatDateOnly(now());
    const generatedAt = nowIsoString();
    const excludeKey = SuggestionCacheService.buildExcludeKey(excludeIds);
    const locale = options?.locale ?? 'zh-CN';
    const sourceVersion = options?.sourceVersion;

    // 0. Check suggestion result cache
    const cachedResult = await this.presentation.getCachedResult(
      userId,
      targetDate,
      excludeKey,
    );
    if (
      cachedResult != null &&
      (sourceVersion == null || cachedResult.sourceVersion === sourceVersion)
    ) {
      if (options?.onSuccessfulRecompute != null) {
        const { signals } = await this.pipeline.run(userId, targetDate);
        await options.onSuccessfulRecompute(signals);
      }

      return {
        generatedAt,
        primary: cachedResult.primary,
        secondary: cachedResult.secondary,
        observations: cachedResult.observations,
        materializationStatus: 'ready',
        sourceVersion: sourceVersion ?? cachedResult.sourceVersion,
        computedAt: generatedAt,
        retryAfterSeconds: null,
      };
    }

    // 1. Pipeline: collect signals → run rules → suppress → arbitrate
    const { arbitrationResult, degraded, signals } = await this.pipeline.run(
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
    if (sourceVersion == null) {
      await this.lifecycle.expireStaleSuggestions(userId, targetDate);
    } else {
      await this.lifecycle.expireStaleSuggestions(
        userId,
        targetDate,
        sourceVersion,
      );
    }

    let primaryItem: SuggestionItemDto | undefined;
    const secondaryItems: SuggestionItemDto[] = [];

    if (arbitrationResult.primary != null) {
      const copy = this.presentation.resolveCopy(
        copyResults,
        arbitrationResult.primary.copyGeneration.templateKey,
        arbitrationResult.primary.copyGeneration.params,
        locale,
      );
      const id =
        sourceVersion == null
          ? await this.lifecycle.persistActive(
              userId,
              arbitrationResult.primary,
              targetDate,
              copy,
              locale,
            )
          : await this.lifecycle.persistActive(
              userId,
              arbitrationResult.primary,
              targetDate,
              copy,
              locale,
              sourceVersion,
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
      const id =
        sourceVersion == null
          ? await this.lifecycle.persistActive(
              userId,
              candidate,
              targetDate,
              copy,
              locale,
            )
          : await this.lifecycle.persistActive(
              userId,
              candidate,
              targetDate,
              copy,
              locale,
              sourceVersion,
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
      materializationStatus: 'ready',
      sourceVersion: sourceVersion ?? 0,
      computedAt: generatedAt,
      retryAfterSeconds: null,
    };

    // 7. Cache the result for subsequent requests
    await this.presentation.cacheResult(userId, targetDate, excludeKey, result);

    await options?.onSuccessfulRecompute?.(signals);

    return result;
  }

  /**
   * Compatibility entry point for existing explicit callers. New GET paths
   * must use {@link readCurrent}; background work uses {@link recompute}.
   */
  async generate(
    userId: string,
    date?: string,
    excludeIds?: string[],
    options?: SuggestionRecomputeOptions,
  ): Promise<TodaySuggestionsDataDto> {
    return this.recompute(userId, date, excludeIds, options);
  }

  private materializationMetadata(
    status: MaterializationStatusView,
  ): Pick<
    TodaySuggestionsDataDto,
    | 'materializationStatus'
    | 'sourceVersion'
    | 'computedAt'
    | 'retryAfterSeconds'
  > {
    return {
      materializationStatus: status.status,
      sourceVersion: status.sourceVersion,
      computedAt: status.computedAt?.toISOString() ?? null,
      retryAfterSeconds:
        status.status === 'pending'
          ? 2
          : status.status === 'failed'
            ? 30
            : null,
    };
  }
}
