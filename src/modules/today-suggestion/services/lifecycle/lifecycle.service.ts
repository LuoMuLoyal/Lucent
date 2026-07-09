import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { nowIsoString } from '../../../../common/helpers/date-time.utils';
import type { SuggestionCandidate, SuggestionAction } from '../../types';
import { SuggestionLifecycleState } from '../../types';
import type { SuggestionHistoryItemDto } from '../../dto/suggestion-history-query.dto';
import type { Prisma } from '#generated/prisma/client';

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

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists a candidate as a new ACTIVE suggestion in the DB.
   * Returns the generated suggestion id.
   */
  async persistActive(
    userId: string,
    candidate: SuggestionCandidate,
    date: string,
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
        title: candidate.title,
        reason: candidate.reason,
        boundary: candidate.boundary,
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

    return { items, total };
  }

  /** Returns the default start date for the history query (N days ago). */
  static getDefaultStartDate(): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - HISTORY_DEFAULT_DAYS);
    return d.toISOString().slice(0, 10);
  }
}
