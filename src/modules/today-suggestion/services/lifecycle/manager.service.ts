import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../../../prisma/index.js';
import { now, nowIsoString, formatDateOnly } from '../../../../common/index.js';
import type { SuggestionCandidate } from '../../types/candidate.types.js';
import type { SuggestionItemDto } from '../../dto/suggestion-response.dto.js';

import type { SuggestionAction } from '../../types/signal.types.js';
import {
  SuggestionFeedback,
  SuggestionLifecycleState,
} from '../../types/suggestion.types.js';
import type { SuggestionHistoryItemDto } from '../../dto/suggestion-history-query.dto.js';
import type { Prisma } from '#generated/prisma/client.js';
import {
  SUGGESTION_ACTIVE_DURATION_MS,
  SUGGESTION_FADING_DURATION_MS,
} from '../../constants/lifecycle.constants.js';

/** Max items returned by the history endpoint. */
const HISTORY_MAX_LIMIT = 500;
const HISTORY_DEFAULT_LIMIT = 100;
const HISTORY_DEFAULT_DAYS = 30;
const HISTORY_CACHE_KEY_PREFIX = 'suggestion:history';

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
    locale: string,
    sourceVersion?: number,
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
        locale: this.normalizeLocale(locale),
        ...(sourceVersion != null ? { sourceVersion } : {}),
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
  async expireStaleSuggestions(
    userId: string,
    date: string,
    sourceVersion?: number,
  ): Promise<number> {
    const result = await this.prisma.userSuggestion.updateMany({
      where: {
        userId,
        date: date,
        lifecycleState: SuggestionLifecycleState.ACTIVE,
        ...(sourceVersion != null
          ? { sourceVersion: { lte: sourceVersion } }
          : {}),
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
   * Reads the persisted active cards used to recover a result after the
   * short-lived suggestion result cache expires. Persisted copy is already
   * localized, so this method never invokes copy generation. The materialized
   * Today result has one current locale; do not filter by request locale or a
   * cache miss in another locale would hide the persisted current cards.
   */
  async getActiveSuggestions(
    userId: string,
    date: string,
    sourceVersion?: number,
  ): Promise<SuggestionItemDto[]> {
    const records = await this.prisma.userSuggestion.findMany({
      where: {
        userId,
        date,
        lifecycleState: SuggestionLifecycleState.ACTIVE,
        ...(sourceVersion != null ? { sourceVersion } : {}),
      },
      orderBy: { priorityScore: 'desc' },
    });

    return records.map((record) => ({
      id: record.id,
      type: record.type as SuggestionItemDto['type'],
      cardTone: this.cardToneFor(record.type),
      icon: this.iconFor(record.type, record.subtype),
      title: record.title,
      reason: record.reason,
      evidence: record.evidence as never,
      boundary: record.boundary,
      primaryAction: record.primaryAction as never,
      ...(record.secondaryActions != null
        ? { secondaryActions: record.secondaryActions as never }
        : {}),
      confidence: record.confidence as SuggestionItemDto['confidence'],
      ruleId: record.ruleId,
      ruleVersion: record.ruleVersion,
      triggerType: record.triggerType as SuggestionItemDto['triggerType'],
      lifecycleState: SuggestionLifecycleState.ACTIVE,
      notificationEligible: record.notificationEligible,
      feedbackOptions: this.feedbackOptionsFor(record.type),
      subtype: record.subtype ?? undefined,
    }));
  }

  private cardToneFor(type: string): SuggestionItemDto['cardTone'] {
    if (type === 'confirmed_risk' || type === 'compliance') return 'urgent';
    if (type === 'trend') return 'warning';
    if (type === 'behavior_advice') return 'soft';
    return 'neutral';
  }

  private iconFor(type: string, subtype: string | null): string {
    const subtypeIcons: Record<string, string> = {
      water: 'droplets',
      sleep: 'moon',
      symptom: 'activity',
      caffeine: 'coffee',
      profile: 'user',
      empty_today: 'clipboard',
    };
    if (subtype != null && subtypeIcons[subtype] != null) {
      return subtypeIcons[subtype];
    }
    const typeIcons: Record<string, string> = {
      confirmed_risk: 'alert-triangle',
      compliance: 'pill',
      trend: 'trending-up',
      behavior_advice: 'lightbulb',
      coverage: 'info',
    };
    return typeIcons[type] ?? 'lightbulb';
  }

  private feedbackOptionsFor(
    type: string,
  ): SuggestionItemDto['feedbackOptions'] {
    return type === 'coverage'
      ? [SuggestionFeedback.ACCEPTED, SuggestionFeedback.LATER]
      : [
          SuggestionFeedback.ACCEPTED,
          SuggestionFeedback.LATER,
          SuggestionFeedback.NOT_APPLICABLE,
          SuggestionFeedback.SUPPRESS,
        ];
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
    locale: string,
    filters?: {
      lifecycleState?: string;
      type?: string;
      limit?: number;
    },
  ): Promise<{ items: SuggestionHistoryItemDto[]; total: number }> {
    const normalizedLocale = this.normalizeLocale(locale);
    const limit = Math.min(
      filters?.limit ?? HISTORY_DEFAULT_LIMIT,
      HISTORY_MAX_LIMIT,
    );

    const cacheKey = [
      HISTORY_CACHE_KEY_PREFIX,
      userId,
      startDate,
      endDate,
      normalizedLocale,
      filters?.lifecycleState ?? 'all',
      filters?.type ?? 'all',
      String(limit),
    ].join(':');

    let cached:
      | {
          items: SuggestionHistoryItemDto[];
          total: number;
        }
      | undefined;
    try {
      cached = await this.cache.get<{
        items: SuggestionHistoryItemDto[];
        total: number;
      }>(cacheKey);
    } catch (error) {
      this.logger.warn(
        `Suggestion history cache get failed (key=${cacheKey}): ${String(error)}`,
      );
      throw error;
    }
    if (cached != null) {
      return cached;
    }

    const where: Prisma.UserSuggestionWhereInput = {
      userId,
      date: { gte: startDate, lte: endDate },
      locale: normalizedLocale,
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

    const items: SuggestionHistoryItemDto[] = Array.from(
      records
        .reduce((map, r) => {
          const key = `${r.ruleId}:${r.subtype ?? ''}`;
          const existing = map.get(key);
          if (
            existing == null ||
            LifecycleService.rank(existing.lifecycleState) <
              LifecycleService.rank(r.lifecycleState as never)
          ) {
            map.set(key, {
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
            });
          }
          return map;
        }, new Map<string, SuggestionHistoryItemDto>())
        .values(),
    );

    const result = { items, total };
    try {
      await this.cache.set(
        cacheKey,
        result,
        LifecycleService.HISTORY_CACHE_TTL_MS,
      );
    } catch (error) {
      this.logger.warn(
        `Suggestion history cache set failed (key=${cacheKey}): ${String(error)}`,
      );
      throw error;
    }
    return result;
  }

  /** Returns the default start date for the history query (N days ago). */
  static getDefaultStartDate(): string {
    const d = now();
    d.setDate(d.getDate() - HISTORY_DEFAULT_DAYS);
    return formatDateOnly(d);
  }

  /**
   * Periodically transitions suggestion lifecycle states based on time elapsed
   * since activation.
   *
   * - ACTIVE → FADING: after SUGGESTION_ACTIVE_DURATION_MS (8h)
   * - FADING → EXPIRED: after SUGGESTION_ACTIVE_DURATION_MS + SUGGESTION_FADING_DURATION_MS (12h)
   *
   * Runs every 5 minutes via BullMQ Repeatable Job. Safe to call concurrently —
   * updateMany is idempotent and the WHERE clause prevents double-transition.
   */
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

  /**
   * Ranks lifecycle states so that the most "current" state wins when
   * deduplicating history by ruleId + subtype.
   */
  private static rank(state: SuggestionLifecycleState): number {
    switch (state) {
      case SuggestionLifecycleState.ACTIVE:
        return 3;
      case SuggestionLifecycleState.FADING:
        return 2;
      case SuggestionLifecycleState.DISMISSED:
        return 1;
      default:
        return 0;
    }
  }

  /**
   * Normalizes a locale string to the canonical form stored with suggestions.
   * Falls back to the language code only, then to the default 'zh-CN'.
   */
  private normalizeLocale(locale: string): string {
    const normalized = locale.trim().toLowerCase();
    if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN';
    if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
    return normalized || 'zh-CN';
  }
}
