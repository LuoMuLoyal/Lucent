import { Injectable } from '@nestjs/common';
import type { Prisma } from '#generated/prisma/client.js';
import { PrismaService } from '../../../../prisma/index.js';
import {
  ACTIVE_LIFECYCLE_STATE,
  type ActiveSuggestionRow,
  type SuggestionHistoryQuery,
  type SuggestionHistoryRow,
  type SuggestionQueryPort,
} from '../../application/ports/suggestion-queries.js';
import type { SuggestionLifecycleState } from '../../domain/suggestion/daily-suggestion.js';

/**
 * Prisma implementation of the suggestion query port.
 *
 * The `where` clauses the read models used to build inline now live here, with
 * one deliberate change: the Today filter reads
 * {@link ACTIVE_LIFECYCLE_STATE} from the port instead of hardcoding the state
 * name, so "what counts as current" has a single source shared with the
 * domain's `lifecycleRank`.
 */
@Injectable()
export class PrismaSuggestionQueries implements SuggestionQueryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findActive(
    userId: string,
    date: string,
    sourceVersion?: number,
  ): Promise<ActiveSuggestionRow[]> {
    const rows = await this.prisma.userSuggestion.findMany({
      where: {
        userId,
        date,
        lifecycleState: ACTIVE_LIFECYCLE_STATE,
        ...(sourceVersion != null ? { sourceVersion } : {}),
      },
      orderBy: { priorityScore: 'desc' },
    });

    return rows.map((row) => ({
      id: row.id,
      date: row.date,
      type: row.type,
      triggerType: row.triggerType,
      ruleId: row.ruleId,
      ruleVersion: row.ruleVersion,
      subtype: row.subtype,
      title: row.title,
      reason: row.reason,
      boundary: row.boundary,
      evidence: row.evidence,
      primaryAction: row.primaryAction,
      secondaryActions: row.secondaryActions,
      priorityScore: row.priorityScore,
      confidence: row.confidence,
      notificationEligible: row.notificationEligible,
      locale: row.locale,
      generatedAt: row.generatedAt,
    }));
  }

  async findHistory(
    query: SuggestionHistoryQuery,
  ): Promise<{ rows: SuggestionHistoryRow[]; total: number }> {
    const where: Prisma.UserSuggestionWhereInput = {
      userId: query.userId,
      date: { gte: query.startDate, lte: query.endDate },
      locale: query.locale,
    };
    if (query.lifecycleState != null) {
      where.lifecycleState = query.lifecycleState;
    }
    if (query.type != null) {
      where.type = query.type as never;
    }

    const [records, total] = await Promise.all([
      this.prisma.userSuggestion.findMany({
        where,
        orderBy: { generatedAt: 'desc' },
        take: query.limit,
      }),
      this.prisma.userSuggestion.count({ where }),
    ]);

    return {
      rows: records.map((row) => ({
        id: row.id,
        date: row.date,
        type: row.type,
        triggerType: row.triggerType,
        ruleId: row.ruleId,
        ruleVersion: row.ruleVersion,
        subtype: row.subtype,
        lifecycleState: row.lifecycleState as SuggestionLifecycleState,
        title: row.title,
        reason: row.reason,
        boundary: row.boundary,
        evidence: row.evidence,
        primaryAction: row.primaryAction,
        secondaryActions: row.secondaryActions,
        priorityScore: row.priorityScore,
        confidence: row.confidence,
        generatedAt: row.generatedAt,
        activatedAt: row.activatedAt,
        fadingAt: row.fadingAt,
        expiredAt: row.expiredAt,
        feedback: row.feedback,
        feedbackAt: row.feedbackAt,
        locale: row.locale,
      })),
      total,
    };
  }
}
