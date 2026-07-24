import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../../prisma';
import { now, nowIsoString } from '../../../../common';
import type { SuggestionCandidate } from '../../types/candidate.types';

import type { SuggestionAction } from '../../types/signal.types';
import { SuggestionLifecycleState } from '../../types/suggestion.types';
import type { SuggestionHistoryItemDto } from '../../dto/suggestion-history-query.dto';
import type { Prisma } from '#generated/prisma/client';
import {
  SUGGESTION_ACTIVE_DURATION_MS,
  SUGGESTION_FADING_DURATION_MS,
  LIFECYCLE_REFRESH_CRON,
} from '../../constants/lifecycle.constants';

/** Max items returned by the history endpoint. */
const HISTORY_MAX_LIMIT = 500;
const HISTORY_DEFAULT_LIMIT = 100;
const HISTORY_DEFAULT_DAYS = 30;

/**
 * Manages suggestion card lifecycle: persisting new suggestions,
 * expiring stale ones, and querying active/dismissed state.
 */
@Injectable()
export class LifecycleService {
  private readonly logger = new Logger(LifecycleService.name);

  private static readonly HISTORY_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /**
   * Persists a candidate as a new ACTIVE suggestion in the DB.
   * Returns the generated suggestion id.
   *
   * @param copy - The copy result (AI or fallback) to persist as title/reason/boundary.
   */
  async persistActive(
    userId: string,
    candidate: SuggestionCandidate,
    date: string,
    copy: { title: string; reason: string; boundary: string },
  ): Promise<string> {
    const now = nowIsoString();

    const record = await this.prisma.userSuggestion.create({
      data: {
        userId,
        date: date,
        type: candidate.type,
        triggerType: candidate.triggerType,
        ruleId: candidate.ruleId,
        ruleVersion: candidate.ruleVersion,
        title: copy.title,
        reason: copy.reason,
        boundary: copy.boundary,
        evidence: candidate.evidence as never,
        primaryAction: candidate.primaryAction as never,
        ...this.optionalSecondaryActions(candidate.secondaryActions),
        priorityScore: candidate.priorityScore,
        confidence: candidate.confidence,
        lifecycleState: SuggestionLifecycleState.ACTIVE,
        notificationEligible: candidate.notificationEligible,
        ...this.optionalSubtype(candidate.subtype),
        generatedAt: now,
        activatedAt: now,
      },
    });

    return record.id;
  }

  private optionalSecondaryActions(
    actions: SuggestionAction[] | undefined,
  ): Record<string, unknown> {
    if (actions == null) return {};
    return { secondaryActions: actions };
  }

  private optionalSubtype(
    subtype: string | undefined,
  ): Record<string, unknown> {
    if (subtype == null) return {};
    return { subtype };
  }

  /**
   * Expires suggestions that are no longer active for the given user+date.
   * Called before generating new suggestions to clean up stale cards.
   */
  async expireStaleSuggestions(userId: string, date: string): Promise<number> {
    const result = await this.prisma.userSuggestion.updateMany({
      where: {
        userId,
        date: date,
        lifecycleState: SuggestionLifecycleState.ACTIVE,
        // Expire suggestions not in the current candidate set
        // (they will be replaced by new ones)
      },
      data: {
        lifecycleState: SuggestionLifecycleState.EXPIRED,
        expiredAt: nowIsoString(),
      },
    });

    if (result.count > 0) {
      this.logger.debug(
        `Expired ${String(result.count)} stale suggestions for user ${userId} on ${date}`,
      );
    }

    return result.count;
  }

  /**
   * Marks a suggestion as dismissed by the user.
   */
  async dismissSuggestion(userId: string, suggestionId: string): Promise<void> {
    await this.prisma.userSuggestion.updateMany({
      where: {
        id: suggestionId,
        userId,
        lifecycleState: SuggestionLifecycleState.ACTIVE,
      },
      data: {
        lifecycleState: SuggestionLifecycleState.DISMISSED,
      },
    });
  }

  /**
   * Returns the IDs of currently active suggestions for the user+date.
   * Used to avoid re-creating identical cards.
   */
  async getActiveSuggestionIds(
    userId: string,
    date: string,
  ): Promise<Set<string>> {
    const records = await this.prisma.userSuggestion.findMany({
      where: {
        userId,
        date: date,
        lifecycleState: SuggestionLifecycleState.ACTIVE,
      },
      select: { ruleId: true, subtype: true },
    });

    // Use ruleId+subtype as a composite key for deduplication
    return new Set(records.map((r) => `${r.ruleId}:${r.subtype ?? ''}`));
  }

  /**
   * Returns suggestion history for the Report page.
   * Supports optional filtering by lifecycleState and suggestion type,
   * and applies a sane default date range + limit.
   */
  async getHistory(
    userId: string,
    startDate: string,
    endDate: string,
    filters?: {
      lifecycleState?: string;
      type?: string;
      limit?: number;
    },
  ): Promise<{ items: SuggestionHistoryItemDto[]; total: number }> {
    const limit = Math.min(
      filters?.limit ?? HISTORY_DEFAULT_LIMIT,
      HISTORY_MAX_LIMIT,
    );

    const cacheKey = [
      'suggestion:history',
      userId,
      startDate,
      endDate,
      filters?.lifecycleState ?? 'all',
      filters?.type ?? 'all',
      String(limit),
    ].join(':');

    const cached = await this.cache.get<{
      items: SuggestionHistoryItemDto[];
      total: number;
    }>(cacheKey);
    if (cached != null) {
      return cached;
    }

    const where: Prisma.UserSuggestionWhereInput = {
      userId,
      date: { gte: startDate, lte: endDate },
    };
    if (filters?.lifecycleState != null) {
      where.lifecycleState = filters.lifecycleState as never;
    }
    if (filters?.type != null) {
      where.type = filters.type as never;
    }

    const [records, total] = await Promise.all([
      this.prisma.userSuggestion.findMany({
        where,
        orderBy: { generatedAt: 'desc' },
        take: limit,
      }),
      this.prisma.userSuggestion.count({ where }),
    ]);

    const items: SuggestionHistoryItemDto[] = records.map((r) => ({
      id: r.id,
      date: r.date,
      type: r.type as never,
      title: r.title,
      reason: r.reason,
      ruleId: r.ruleId,
      ruleVersion: r.ruleVersion,
      triggerType: r.triggerType as never,
      lifecycleState: r.lifecycleState as never,
      confidence: r.confidence as never,
      subtype: r.subtype ?? undefined,
      feedback: r.feedback ?? undefined,
      feedbackAt: r.feedbackAt?.toISOString() ?? undefined,
      generatedAt: r.generatedAt.toISOString(),
      expiredAt: r.expiredAt?.toISOString() ?? undefined,
    }));

    const result = { items, total };
    await this.cache.set(
      cacheKey,
      result,
      LifecycleService.HISTORY_CACHE_TTL_MS,
    );
    return result;
  }

  /** Returns the default start date for the history query (N days ago). */
  static getDefaultStartDate(): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - HISTORY_DEFAULT_DAYS);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Periodically transitions suggestion lifecycle states based on time elapsed
   * since activation.
   *
   * - ACTIVE → FADING: after SUGGESTION_ACTIVE_DURATION_MS (8h)
   * - FADING → EXPIRED: after SUGGESTION_ACTIVE_DURATION_MS + SUGGESTION_FADING_DURATION_MS (12h)
   *
   * Runs every 5 minutes via @Cron. Safe to call concurrently — updateMany is
   * idempotent and the WHERE clause prevents double-transition.
   */
  @Cron(LIFECYCLE_REFRESH_CRON)
  async refreshLifecycleStates(): Promise<void> {
    const currentTime = now();
    const activeThreshold = new Date(
      currentTime.getTime() - SUGGESTION_ACTIVE_DURATION_MS,
    );
    const fadingThreshold = new Date(
      currentTime.getTime() -
        SUGGESTION_ACTIVE_DURATION_MS -
        SUGGESTION_FADING_DURATION_MS,
    );

    // ACTIVE → FADING
    const fadingResult = await this.prisma.userSuggestion.updateMany({
      where: {
        lifecycleState: SuggestionLifecycleState.ACTIVE,
        activatedAt: { lt: activeThreshold },
      },
      data: {
        lifecycleState: SuggestionLifecycleState.FADING,
        fadingAt: nowIsoString(),
      },
    });

    // FADING → EXPIRED
    const expiredResult = await this.prisma.userSuggestion.updateMany({
      where: {
        lifecycleState: SuggestionLifecycleState.FADING,
        activatedAt: { lt: fadingThreshold },
      },
      data: {
        lifecycleState: SuggestionLifecycleState.EXPIRED,
        expiredAt: nowIsoString(),
      },
    });

    if (fadingResult.count > 0 || expiredResult.count > 0) {
      this.logger.debug(
        `Lifecycle refresh: ${String(fadingResult.count)} active→fading, ${String(expiredResult.count)} fading→expired`,
      );
    }
  }
}
