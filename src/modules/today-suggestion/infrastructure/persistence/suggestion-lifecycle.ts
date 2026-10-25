import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/index.js';
import { nowIsoString } from '../../../../common/index.js';
import { SuggestionLifecycleState } from '../../domain/suggestion/suggestion.types.js';
import {
  SuggestionLifecycleStore,
  type ActiveCardKey,
  type PersistActiveInput,
} from '../../application/ports/suggestion-lifecycle.js';

/**
 * Prisma implementation of {@link SuggestionLifecycleStore}.
 *
 * Holds every query `LifecycleService` used to run itself, so the application
 * layer no longer imports Prisma (ADR-0024 §4.2). The batch transitions stay
 * `updateMany`: it is idempotent and its `WHERE` clause prevents a
 * double-transition, which a load-modify-save loop would have to re-earn.
 */
@Injectable()
export class PrismaSuggestionLifecycleStore extends SuggestionLifecycleStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async createActive(input: PersistActiveInput): Promise<string> {
    const { candidate, copy } = input;
    const record = await this.prisma.userSuggestion.create({
      data: {
        userId: input.userId,
        date: input.date,
        type: candidate.type,
        triggerType: candidate.triggerType,
        ruleId: candidate.ruleId,
        ruleVersion: candidate.ruleVersion,
        title: copy.title,
        reason: copy.reason,
        boundary: copy.boundary,
        evidence: candidate.evidence as never,
        primaryAction: candidate.primaryAction as never,
        ...optionalSecondaryActions(candidate.secondaryActions),
        priorityScore: candidate.priorityScore,
        confidence: candidate.confidence,
        lifecycleState: SuggestionLifecycleState.ACTIVE,
        notificationEligible: candidate.notificationEligible,
        ...optionalSubtype(candidate.subtype),
        locale: input.locale,
        ...(input.sourceVersion != null
          ? { sourceVersion: input.sourceVersion }
          : {}),
        generatedAt: input.generatedAt,
        activatedAt: input.generatedAt,
      },
    });

    return record.id;
  }

  async expireActive(
    userId: string,
    date: string,
    expiredAt: string,
    sourceVersion?: number | undefined,
  ): Promise<number> {
    const result = await this.prisma.userSuggestion.updateMany({
      where: {
        userId,
        date,
        lifecycleState: SuggestionLifecycleState.ACTIVE,
        ...(sourceVersion != null
          ? { sourceVersion: { lte: sourceVersion } }
          : {}),
      },
      data: {
        lifecycleState: SuggestionLifecycleState.EXPIRED,
        expiredAt,
      },
    });

    return result.count;
  }

  async dismissActive(userId: string, suggestionId: string): Promise<void> {
    await this.prisma.userSuggestion.updateMany({
      where: {
        id: suggestionId,
        userId,
        lifecycleState: SuggestionLifecycleState.ACTIVE,
      },
      data: { lifecycleState: SuggestionLifecycleState.DISMISSED },
    });
  }

  async listActiveCardKeys(
    userId: string,
    date: string,
  ): Promise<ActiveCardKey[]> {
    return this.prisma.userSuggestion.findMany({
      where: {
        userId,
        date,
        lifecycleState: SuggestionLifecycleState.ACTIVE,
      },
      select: { ruleId: true, subtype: true },
    });
  }

  async fadeActiveBefore(threshold: Date): Promise<number> {
    const result = await this.prisma.userSuggestion.updateMany({
      where: {
        lifecycleState: SuggestionLifecycleState.ACTIVE,
        activatedAt: { lt: threshold },
      },
      data: {
        lifecycleState: SuggestionLifecycleState.FADING,
        fadingAt: nowIsoString(),
      },
    });

    return result.count;
  }

  async expireFadingBefore(threshold: Date): Promise<number> {
    const result = await this.prisma.userSuggestion.updateMany({
      where: {
        lifecycleState: SuggestionLifecycleState.FADING,
        activatedAt: { lt: threshold },
      },
      data: {
        lifecycleState: SuggestionLifecycleState.EXPIRED,
        expiredAt: nowIsoString(),
      },
    });

    return result.count;
  }
}

function optionalSecondaryActions(
  actions: readonly unknown[] | undefined,
): Record<string, unknown> {
  if (actions == null) return {};
  return { secondaryActions: actions };
}

function optionalSubtype(subtype: string | undefined): Record<string, unknown> {
  if (subtype == null) return {};
  return { subtype };
}
