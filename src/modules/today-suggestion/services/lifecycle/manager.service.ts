import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../../../prisma/index.js';
import { now, nowIsoString, formatDateOnly } from '../../../../common/index.js';
import type { SuggestionCandidate } from '../../domain/suggestion/suggestion-candidate.js';
import type { SuggestionItemDto } from '../../dto/suggestion-response.dto.js';

import type { SuggestionAction } from '../../domain/signal/signal.js';
import { SuggestionLifecycleState } from '../../domain/suggestion/suggestion.types.js';
import type { SuggestionHistoryItemDto } from '../../dto/suggestion-history-query.dto.js';
import {
  fadeExpiryThreshold,
  fadingThreshold,
} from '../../domain/suggestion/daily-suggestion.js';
import { ActiveSuggestionsReadModel } from '../../application/read_models/active-suggestions.js';
import {
  SuggestionHistoryReadModel,
  type SuggestionHistoryPage,
} from '../../application/read_models/suggestion-history.js';

/** Max items returned by the history endpoint. */
const HISTORY_MAX_LIMIT = 500;
const HISTORY_DEFAULT_LIMIT = 100;
const HISTORY_DEFAULT_DAYS = 30;
const HISTORY_CACHE_KEY_PREFIX = 'suggestion:history';

/**
 * Manages suggestion card lifecycle: persisting new suggestions,
 * expiring stale ones, and querying active/dismissed state.
 *
 * ## Migration status — two paths coexist (temporarily)
 *
 * **Write side is migrating to domain judgement.** The state ladder and its
 * thresholds now live in `domain/suggestion/daily-suggestion.ts`
 * (`fadingThreshold`, `fadeExpiryThreshold`, `lifecycleRank`), and this class
 * calls them instead of restating 8h/12h inline. The batch transitions stay as
 * `updateMany` on purpose: it is idempotent and safe to run concurrently, which
 * a load-modify-save loop would have to re-earn.
 *
 * **Read side still queries Prisma directly** (`getActiveSuggestions`,
 * `getHistory`). Those are read models and move in D3 step 5.
 *
 * The two must not coexist long-term: "write through the domain rule, read
 * straight from the table" is exactly the kind of intermediate state that keeps
 * working, so nobody notices it never got finished. Tracked in `docs/TODO.md`.
 */
@Injectable()
export class LifecycleService {
  private readonly logger = new Logger(LifecycleService.name);

  private static readonly HISTORY_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly activeReadModel: ActiveSuggestionsReadModel,
    private readonly historyReadModel: SuggestionHistoryReadModel,
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
   * localized, so this method never invokes copy generation.
   *
   * The **action and evidence labels are localized here**, not read from the
   * persisted JSON: the stored `primaryAction` still carries the rule's raw
   * template key (`complete_profile`), which is an internal identifier. This
   * path used to pass it through verbatim, so the same card showed a proper
   * label on a result-cache hit and the raw key on a miss — see
   * `docs/TODO.md`「Today 建议卡的服务端契约缺口」.
   *
   * The materialized Today result has one current locale; it is deliberately
   * not filtered by request locale, because a cache miss in another locale
   * would otherwise hide the persisted current cards. Consequence: the card's
   * copy language is fixed at recompute time, so the request locale is used
   * only for the labels localized here.
   */
  async getActiveSuggestions(
    userId: string,
    date: string,
    sourceVersion?: number,
    locale = 'zh-CN',
  ): Promise<SuggestionItemDto[]> {
    return this.activeReadModel.getActiveSuggestions(
      userId,
      date,
      sourceVersion,
      locale,
    );
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

    let cached: SuggestionHistoryPage | undefined;
    try {
      cached = await this.cache.get<SuggestionHistoryPage>(cacheKey);
    } catch (error) {
      // Cache is an accelerator, not a gate: fall through to the query.
      this.logger.warn(
        `Suggestion history cache get failed (key=${cacheKey}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (cached != null) {
      return cached;
    }

    // Query, dedup and DTO shaping live in the read model; caching stays here.
    const result = await this.historyReadModel.getHistory({
      userId,
      startDate,
      endDate,
      locale: normalizedLocale,
      lifecycleState: filters?.lifecycleState as never,
      type: filters?.type,
      limit,
    });

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
    // Thresholds come from the domain rule, not from arithmetic repeated here.
    const activeThreshold = fadingThreshold(currentTime);
    const expiryThreshold = fadeExpiryThreshold(currentTime);

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
        activatedAt: { lt: expiryThreshold },
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
