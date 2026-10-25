/**
 * Today's suggestion cards (`application/read_models`).
 *
 * A projection: rows in, DTOs out. It owns three decisions the endpoint makes
 * on top of the query, and nothing else:
 *
 * 1. **which rows are "today's"** — `ACTIVE_LIFECYCLE_STATE`, shared with the
 *    domain's notion of a current card rather than hardcoded in SQL;
 * 2. **how a card is presented** — tone, icon, feedback options, and the
 *    localization of evidence labels and action labels;
 * 3. **the copy language caveat** — see below.
 *
 * Localization note: the materialized result has one current locale and is
 * deliberately *not* filtered by request locale, because a cache miss in
 * another locale would hide the persisted current cards. The consequence is
 * that card copy is fixed at recompute time; the request locale only affects
 * the labels localized here.
 */

import { Inject, Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { SuggestionFeedback } from '../../domain/suggestion/suggestion.types.js';
import type { SuggestionItemDto } from '../../dto/suggestion-response.dto.js';
import {
  localizeEvidenceLabel,
  localizeEvidenceValue,
  resolveActionLabel,
} from '../../services/action-label.js';
import { SUGGESTION_QUERY_PORT } from '../ports/suggestion-queries.js';
import { ACTIVE_LIFECYCLE_STATE } from '../ports/suggestion-queries.js';
import type {
  ActiveSuggestionRow,
  SuggestionQueryPort,
} from '../ports/suggestion-queries.js';

/** Shapes and localizes the Today page's card list. */
@Injectable()
export class ActiveSuggestionsReadModel {
  constructor(
    @Inject(SUGGESTION_QUERY_PORT)
    private readonly queries: SuggestionQueryPort,
    private readonly i18n: I18nService,
  ) {}

  async getActiveSuggestions(
    userId: string,
    date: string,
    sourceVersion?: number,
    locale = 'zh-CN',
  ): Promise<SuggestionItemDto[]> {
    const rows = await this.queries.findActive(userId, date, sourceVersion);
    return rows.map((row) => this.toDto(row, locale));
  }

  private toDto(row: ActiveSuggestionRow, locale: string): SuggestionItemDto {
    const primaryAction = row.primaryAction as {
      actionId: string;
      label: string;
      route: string;
      authRequired: boolean;
    };
    const secondaryActions = row.secondaryActions as Array<{
      actionId: string;
      label: string;
      route: string;
      authRequired: boolean;
    }> | null;
    const evidence = row.evidence as Array<{
      kind: string;
      label: string;
      value: string;
      args?: Record<string, string | number>;
      recordId?: string;
      medicineId?: string;
    }>;

    return {
      id: row.id,
      type: row.type as SuggestionItemDto['type'],
      cardTone: cardToneFor(row.type),
      icon: iconFor(row.type, row.subtype),
      title: row.title,
      reason: row.reason,
      evidence: evidence.map((item) => ({
        ...item,
        label: localizeEvidenceLabel(this.i18n, item.label, locale),
        value: localizeEvidenceValue(this.i18n, item.value, locale, item.args),
      })),
      boundary: row.boundary,
      primaryAction: {
        ...primaryAction,
        label: resolveActionLabel(this.i18n, primaryAction.label, locale),
      },
      ...(secondaryActions != null
        ? {
            secondaryActions: secondaryActions.map((action) => ({
              ...action,
              label: resolveActionLabel(this.i18n, action.label, locale),
            })),
          }
        : {}),
      confidence: row.confidence as SuggestionItemDto['confidence'],
      ruleId: row.ruleId,
      ruleVersion: row.ruleVersion,
      triggerType: row.triggerType as SuggestionItemDto['triggerType'],
      lifecycleState:
        ACTIVE_LIFECYCLE_STATE as SuggestionItemDto['lifecycleState'],
      notificationEligible: row.notificationEligible,
      feedbackOptions: feedbackOptionsFor(row.type),
      subtype: row.subtype ?? undefined,
    };
  }
}

/** Visual tone for a card type. */
function cardToneFor(type: string): SuggestionItemDto['cardTone'] {
  if (type === 'confirmed_risk' || type === 'compliance') return 'urgent';
  if (type === 'trend') return 'warning';
  if (type === 'behavior_advice') return 'soft';
  return 'neutral';
}

/** Icon name for a card, preferring the subtype when one is known. */
function iconFor(type: string, subtype: string | null): string {
  const subtypeIcons: Record<string, string> = {
    water: 'droplets',
    sleep: 'moon',
    symptom: 'activity',
    diet: 'utensils',
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

/**
 * Which feedback buttons a card offers.
 *
 * A coverage card is informational ("your profile is incomplete"), so
 * "not applicable" and "never show this" would both be wrong answers — hence
 * only accept/later.
 */
function feedbackOptionsFor(
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
